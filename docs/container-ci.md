# Container builds and CI

Use the generator image locally or in CI with a checkout containing card YAML
and assets. That checkout can live in a separate repository on any Git host.
Updating a card does not require rebuilding the generator image.

The image provides Node 24, the locked production dependencies, fonts for
initials, a normal shell, and two commands on `PATH`:

- `mecard` generates one card; its arguments match `node build.js`.
- `mecard-site` generates the whole site; its arguments match `node build-site.js`.

The working directory can be the data checkout. Relative photo and logo paths
remain relative to the YAML file that declares them, including shared defaults.
The generator lives at `/opt/mecard`, independently of the checkout location.

## Build and try locally

In the generator checkout:

```sh
docker build -t mecard:local .
scripts/test-container.sh mecard:local
```

The smoke test creates synthetic bilingual cards and a local theme in a
temporary directory. It runs the image without network access, mounts input
read-only, checks both CLI commands, and verifies generated files on the host.

In the data checkout, with `site.yaml` already configured:

```sh
mkdir -p dist
docker run --rm --user "$(id -u):$(id -g)" \
  -v "$PWD:/data:ro" -v "$PWD/dist:/output" -w /data \
  mecard:local mecard-site --config site.yaml --out /output/site --strict
```

This writes `dist/site/` on the host, owned by your user. Mount the **parent**
output directory (`/output`), rather than `/output/site`: the site builder
replaces the site atomically and keeps an ownership marker alongside it.
Add `dist/` to the data repository's `.gitignore`.

For a shell with the same mounts:

```sh
docker run --rm -it --user "$(id -u):$(id -g)" \
  -v "$PWD:/data:ro" -v "$PWD/dist:/output" -w /data \
  mecard:local sh
```

Inside it, run `mecard-site --config site.yaml --out /output/site --strict`.
Input is still read-only; all output goes through the writable output mount.

Podman can run the same image. For rootless Podman, add `--userns=keep-id` to
the run command. On SELinux hosts, use `:ro,z` and `:z` for these overlapping
shared mounts. The smoke test accepts
`CONTAINER_ENGINE=podman scripts/test-container.sh mecard:local`.

## Publish the generator image from GitHub

The `Container Image` workflow builds and smoke-tests the image on pull
requests. On `main`, version tags such as `v1.0.0`, and manual runs, it then
publishes AMD64 and ARM64 images to `ghcr.io/<owner>/<repository>`. It uses the
current repository name, not a hard-coded organization. Pull requests, including
those from forks, do not publish or receive registry credentials. To publish
from your own fork, first enable its GitHub Actions workflows; pushes to that
fork then publish under its own owner/repository name.

The workflow uses GitHub's `GITHUB_TOKEN` with `packages: write` for the publish
job. It produces a full-commit tag (`sha-<40-character-commit>`), a branch tag
(`main`), and a version tag (`1.0.0`) for a matching release tag.

After the first publication, open the package's GitHub settings and change its
visibility to **Public** to allow anonymous pulls from other repositories.
A public source repository does not automatically make a newly created GHCR package public.
An organization may restrict who can change package visibility.

For CI, select a release or commit image; use its
`ghcr.io/<owner>/<repository>@sha256:<digest>` reference when exact image
reproducibility matters. The `main` tag is convenient for trials but moves with
future generator changes. The Node 24 base image receives patch updates on
rebuild; `--build-arg NODE_IMAGE=node:24-bookworm-slim@sha256:<digest>` can pin it
as well.

## GitHub Actions and GitHub Pages

For a separate data repository, copy the
[GitHub Pages workflow](../examples/github-pages.yml) to
`.github/workflows/pages.yml`. Keep its checkout,
Pages configuration, artifact upload and deploy steps. Replace the Node setup,
`npm ci` and generation steps with:

```yaml
- name: Generate the card
  env:
    MECARD_IMAGE: ${{ vars.MECARD_IMAGE }}
    CARD_URL: ${{ steps.pages.outputs.base_url }}
  run: |
    mkdir -p dist
    docker run --rm --user "$(id -u):$(id -g)" \
      -v "$PWD:/data:ro" -v "$PWD/dist:/output" -w /data \
      "$MECARD_IMAGE" mecard --config card.yaml --out /output/card \
      --url "${CARD_URL%/}/" --strict
```

In **Settings → Secrets and variables → Actions → Variables**, add
`MECARD_IMAGE` with a public image tag or digest. Commit `card.yaml` and its
assets, and select **GitHub Actions** in **Settings → Pages**. The workflow
publishes `dist/card/` using GitHub's built-in token. Private repositories need
a [GitHub plan that supports Pages](https://docs.github.com/en/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages).

For a multi-card site, use `mecard-site --config site.yaml --out /output/site
--strict` instead and change the upload path to `dist/site`. Set `site.url` to
the public domain root; project subpaths are not supported by `mecard-site`.
Supply an `index.html` in the output if you also want a home page: the site
builder generates the individual card directories and a 404 page.

## GitLab CI and GitLab Pages

For a separate data repository, use the
[GitLab Pages example](../examples/gitlab-pages.yml) with
`image: "$MECARD_IMAGE"`, remove `before_script`, and replace
`npm run build --` with `mecard` in the script. Add `MECARD_IMAGE` as a
CI/CD variable, and commit `card.yaml` and its assets. The runner uses the
image's shell to build the card; GitLab Pages publishes `dist/card/`.

## GitLab CI and Cloudflare Pages

1. Create a GitLab data repository containing `site.yaml`, the YAML files
   it references, and their theme/assets. The generator repository is not needed
   in this checkout.
2. Copy [`examples/gitlab-ci.yml`](../examples/gitlab-ci.yml) into its root as
   `.gitlab-ci.yml`. Use a GitLab Runner with a Docker or Kubernetes executor:
   the runner checks out the repository inside the job container and invokes
   its shell. No Docker daemon, privileged runner or Docker-in-Docker is needed
   in the job. A shell executor does not apply the `image:` setting.
3. Set `MECARD_IMAGE` in **Settings → CI/CD → Variables** to the published image
   tag or digest. This is not a secret; allow the build job to read it on all
   branches.
4. Protect the default branch and configure the deployment variables below.
5. Push a card change. `build_cards` generates `dist/site/` and saves it as an
   artifact. `deploy_cards` downloads that artifact and publishes it to the
   existing Cloudflare Pages project, only from the protected default branch.

Configure these GitLab variables with environment scope **`production`** and
mark them **Protected**. The build job has no production environment and does
not receive them.

| Variable | Value |
| --- | --- |
| `CLOUDFLARE_API_TOKEN` | Account-scoped API token with **Cloudflare Pages: Edit**. Mark it **Masked and hidden**. |
| `CLOUDFLARE_ACCOUNT_ID` | Account that owns the Pages project. |
| `CLOUDFLARE_PAGES_PROJECT` | Existing Pages project's name. |
| `CLOUDFLARE_PAGES_BRANCH` | Optional override if the project's production branch is not `main`. |

Do not put a token in YAML or run interactive `wrangler login` in CI. The
deployment job uses the API token from its environment and a pinned Wrangler
version. It starts in `dist/site/`, so only the generated site is uploaded.
The artifact contains HTML, favicons and hosting files, rather than the YAML
sources or the entire Git checkout. It expires after a week; `access: maintainer`
limits downloads in the GitLab UI/API and requires GitLab 18.4 or later.

The image defaults to the unprivileged `node` user. Local bind-mount examples
select your UID/GID so generated files remain writable on the host. If a custom
runner uses a different checkout owner, configure its container user to match
that owner (GitLab's `image:docker:user` setting is available for Docker runners).

## References

- [GitLab container jobs](https://docs.gitlab.com/ci/docker/using_docker_images/)
- [GitLab artifact access](https://docs.gitlab.com/ci/yaml/#artifactsaccess)
- [Cloudflare Pages direct upload in CI](https://developers.cloudflare.com/pages/how-to/use-direct-upload-with-continuous-integration/)
- [GitHub container registry](https://docs.github.com/en/packages/working-with-a-github-packages-registry/working-with-the-container-registry)
- [Docker multi-platform GitHub Actions](https://docs.docker.com/build/ci/github-actions/multi-platform/)

# Auto Request Reviews Action

A GitHub Action that automatically requests reviews in pull requests from members of a specified team, up to a designated number of reviewers.

## Usage

```yml
name: Automatically request reviews

on:
  pull_request:
    types: [opened, ready_for_review, reopened]

jobs:
  request-reviews:
    runs-on: ubuntu-latest
    if: ${{ !github.event.pull_request.draft }}
    steps:
      - name: Automatically request reviews
        uses: doist/auto-request-reviews-action@v1
        with:
          reviewers: 2
          team: 'Doist/team'
          token: ${{ secrets.GITHUB_TOKEN }}
```

## Inputs

| Input | Description | Required | Default |
|-------|-------------|----------|---------|
| `reviewers` | Desired total number of reviewers in total | Yes | |
| `team` | Team to pick reviewers from (format: org/team) | Yes | |
| `token` | GitHub token with required permissions (see [Permissions](#permissions)) | Yes | |

## How it works

This action:

1. Fetches the current pull request and counts how many reviewers are already requested
2. Calculates how many more reviewers are needed to reach the specified number
3. Gets all members of the specified team, excluding the PR author, existing reviewers, and the authenticated user
4. Randomly selects the required number of reviewers from eligible team members
5. If there aren't enough eligible team members, requests as many as possible and logs a warning

## Permissions

The default `GITHUB_TOKEN` is not sufficient for this action because it lacks scopes that enable
team member access. You can use a Personal Access Token with the following scopes:

- `repo` (or `public_repo` for public repositories)
- `read:org` (required to access team membership)

Store the PAT as a repository secret and pass it in your workflow.

### Important Note on Authenticated Users

GitHub's API doesn't allow a user to request a review from themselves. This action automatically
filters out the authenticated user (the user associated with the provided token) from the list of
potential reviewers. If you're using a token associated with a team member, that team member will
never be selected as a reviewer.

## Development

### Setup

```bash
npm install
```

### Build

```bash
npm run build
```

This project uses [esbuild](https://esbuild.github.io/) for bundling, which creates a single file with all dependencies included.

### Lint & Format

```bash
# Run linter
npm run lint

# Format code
npm run format
```

This project uses [Biome](https://biomejs.dev/) for both linting and formatting.

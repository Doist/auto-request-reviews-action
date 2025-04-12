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
| `debug` | Enable debug mode for local testing | No | `false` |
| `repo` | Repository name in format 'owner/repo' (only used in debug mode) | No | |
| `pr_number` | Pull request number (only used in debug mode) | No | |

## How it works

This action:

1. Fetches the current pull request and counts how many reviewers are already requested
2. Calculates how many more reviewers are needed to reach the specified number
3. Gets all members of the specified team, excluding the PR author and existing reviewers
4. Randomly selects the required number of reviewers from eligible team members
5. If there aren't enough eligible team members, requests as many as possible and logs a warning

## Permissions

The default `GITHUB_TOKEN` is not sufficient for this action because it lacks scopes that enable
team member access. You can use a Personal Access Token with the following scopes:

- `repo` (or `public_repo` for public repositories)
- `read:org` (required to access team membership)

Store the PAT as a repository secret and pass it in your workflow.

## Debug Mode

If you're testing this action locally or having issues with the default GitHub context, you can use debug mode:

```yml
- name: Automatically request reviews (Debug mode)
  uses: doist/auto-request-reviews-action@v1
  with:
    reviewers: 2
    team: Doist/team
    token: ${{ secrets.GITHUB_TOKEN }}
    debug: 'true'
    repo: octocat/example-repo
    pr_number: 123
```

In debug mode:
1. The action ignores the GitHub context for PR information
2. You manually specify the repository and PR number
3. This is useful for testing or when the action can't detect the PR context

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

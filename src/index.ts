import * as core from '@actions/core'
import * as github from '@actions/github'
import type { GitHub } from '@actions/github/lib/utils'

type Octokit = InstanceType<typeof GitHub>

// Fisher-Yates shuffle: provides uniform distribution, unlike Array.sort(() => Math.random() - 0.5)
function shuffle<T>(array: T[]): T[] {
    const result = [...array]
    for (let i = result.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1))
        ;[result[i], result[j]] = [result[j], result[i]]
    }
    return result
}

async function run(): Promise<void> {
    try {
        // Get inputs
        const desiredReviewers = Number.parseInt(core.getInput('reviewers', { required: true }))
        const teamSlug = core.getInput('team', { required: true }) // format: org/team
        const token = core.getInput('token', { required: true })

        // Split team input into org and team
        const [owner, team] = teamSlug.split('/')
        if (!owner || !team) {
            throw new Error(`Invalid team format. Expected 'org/team', got '${teamSlug}'`)
        }

        // Create an Octokit instance
        const octokit = github.getOctokit(token)
        const context = github.context

        // Ensure we're in a pull request context
        if (!context.payload.pull_request) {
            throw new Error('This action can only be run on pull request events')
        }

        const pullNumber = context.payload.pull_request.number
        const repo = context.repo

        // Get current PR reviewers
        const { data: pullRequest } = await octokit.rest.pulls.get({
            owner: repo.owner,
            repo: repo.repo,
            pull_number: pullNumber,
        })

        // Get requested reviewers
        const { data: reviewRequests } = await octokit.rest.pulls.listRequestedReviewers({
            owner: repo.owner,
            repo: repo.repo,
            pull_number: pullNumber,
        })

        // Get team members
        // Use GraphQL API since member availability is only available there
        const teamMembersQuery = `
      query getTeamMembers($owner: String!, $team: String!) {
        organization(login: $owner) {
          team(slug: $team) {
            members {
              nodes {
                login
                status {
                  indicatesLimitedAvailability
                }
              }
            }
          }
        }
      }
    `
        const { organization } = await octokit.graphql(teamMembersQuery, {
            owner,
            team,
        })
        const teamMembers = organization.team.members.nodes

        // Create a Set of team member logins for efficient lookup
        const teamMemberLogins = new Set(teamMembers.map((member) => member.login))

        // Count existing requested reviewers that are part of the team
        const existingTeamReviewers = reviewRequests.users.filter((user) =>
            teamMemberLogins.has(user.login),
        ).length

        // Calculate how many more reviewers are needed
        const neededReviewers = Math.max(0, desiredReviewers - existingTeamReviewers)

        if (neededReviewers === 0) {
            core.info(
                `PR already has ${existingTeamReviewers} team member reviewer(s) requested. No additional reviewers needed.`,
            )
            return
        }

        core.info(
            `PR has ${existingTeamReviewers} team member reviewer(s) requested. Need to request ${neededReviewers} more.`,
        )

        // Filter out PR author, existing reviewers, and unavailable team members
        const eligibleReviewers = teamMembers
            .filter((member) => member.login !== pullRequest.user?.login)
            .filter((member) => !reviewRequests.users.some((user) => user.login === member.login))
            .filter((member) => !member.status?.indicatesLimitedAvailability)

        if (eligibleReviewers.length === 0) {
            core.warning('No eligible team members found to request reviews from.')
            return
        }

        // Shuffle array to randomize reviewer selection
        const shuffledReviewers = shuffle(eligibleReviewers)

        // Determine the actual number of reviewers we can request
        const actualReviewers = Math.min(neededReviewers, shuffledReviewers.length)

        if (actualReviewers < neededReviewers) {
            core.warning(
                `Requested ${desiredReviewers} reviewers, but only ${actualReviewers} eligible team members available.`,
            )
        }

        // Get the reviewers we'll request
        const reviewersToRequest = shuffledReviewers
            .slice(0, actualReviewers)
            .map((user) => user.login)

        // Request reviews
        if (reviewersToRequest.length > 0) {
            await octokit.rest.pulls.requestReviewers({
                owner: repo.owner,
                repo: repo.repo,
                pull_number: pullNumber,
                reviewers: reviewersToRequest,
            })

            core.info(`Successfully requested reviews from: ${reviewersToRequest.join(', ')}`)
        }
    } catch (error) {
        if (error instanceof Error) {
            core.setFailed(error.message)
        } else {
            core.setFailed(`Unknown error: ${error}`)
        }
    }
}

run()

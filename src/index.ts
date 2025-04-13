import * as core from "@actions/core";
import * as github from "@actions/github";
import type { GitHub } from "@actions/github/lib/utils";

type Octokit = InstanceType<typeof GitHub>;

async function run(): Promise<void> {
  try {
    // Get inputs
    const desiredReviewers = Number.parseInt(
      core.getInput("reviewers", { required: true }),
    );
    const teamSlug = core.getInput("team", { required: true }); // format: org/team
    const token = core.getInput("token", { required: true });

    // Split team input into org and team
    const [owner, team] = teamSlug.split("/");
    if (!owner || !team) {
      throw new Error(
        `Invalid team format. Expected 'org/team', got '${teamSlug}'`,
      );
    }

    // Create an Octokit instance
    const octokit = github.getOctokit(token);
    const context = github.context;

    // Ensure we're in a pull request context
    if (!context.payload.pull_request) {
      throw new Error("This action can only be run on pull request events");
    }

    const pullNumber = context.payload.pull_request.number;
    const repo = context.repo;

    // Get current PR reviewers
    const { data: pullRequest } = await octokit.rest.pulls.get({
      owner: repo.owner,
      repo: repo.repo,
      pull_number: pullNumber,
    });

    // Get requested reviewers
    const { data: reviewRequests } =
      await octokit.rest.pulls.listRequestedReviewers({
        owner: repo.owner,
        repo: repo.repo,
        pull_number: pullNumber,
      });

    // Count existing requested reviewers
    const existingReviewers = reviewRequests.users.length;

    // Calculate how many more reviewers are needed
    const neededReviewers = Math.max(0, desiredReviewers - existingReviewers);

    if (neededReviewers === 0) {
      core.info(
        `PR already has ${existingReviewers} reviewer(s) requested. No additional reviewers needed.`,
      );
      return;
    }

    core.info(
      `PR has ${existingReviewers} reviewer(s) requested. Need to request ${neededReviewers} more.`,
    );

    // Get team members
    const { data: teamMembers } = await octokit.rest.teams.listMembersInOrg({
      org: owner,
      team_slug: team,
    });

    // Get authenticated user (token owner)
    const { data: authenticatedUser } = await octokit.rest.users.getAuthenticated();

    // Filter out PR author, existing reviewers, and the authenticated user
    const eligibleReviewers = teamMembers
      .filter((member) => member.login !== pullRequest.user?.login)
      .filter((member) => member.login !== authenticatedUser.login)
      .filter(
        (member) =>
          !reviewRequests.users.some((user) => user.login === member.login),
      );

    if (eligibleReviewers.length === 0) {
      core.warning("No eligible team members found to request reviews from.");
      return;
    }

    // Shuffle array to randomize reviewer selection
    const shuffledReviewers = [...eligibleReviewers].sort(
      () => Math.random() - 0.5,
    );

    // Determine the actual number of reviewers we can request
    const actualReviewers = Math.min(neededReviewers, shuffledReviewers.length);

    if (actualReviewers < neededReviewers) {
      core.warning(
        `Requested ${desiredReviewers} reviewers, but only ${actualReviewers} eligible team members available.`,
      );
    }

    // Get the reviewers we'll request
    const reviewersToRequest = shuffledReviewers
      .slice(0, actualReviewers)
      .map((user) => user.login);

    // Request reviews
    if (reviewersToRequest.length > 0) {
      core.info(`PR details: ${pullRequest.html_url}`);
      core.info(`Authenticated as ${authenticatedUser.login}`);
      core.info(`Requesting reviews from: ${reviewersToRequest.join(", ")}`);
      
      try {
        // Try using the direct REST API endpoint
        const requestUrl = `/repos/${repo.owner}/${repo.repo}/pulls/${pullNumber}/requested_reviewers`;
        core.info(`Using API endpoint: ${requestUrl}`);
        
        // Use direct REST API call instead of the helper method
        const response = await octokit.request(`POST ${requestUrl}`, {
          reviewers: reviewersToRequest,
          headers: {
            accept: 'application/vnd.github.v3+json'
          }
        });
        
        core.info(`API response status: ${response.status}`);
        core.info(`Successfully requested reviews from: ${reviewersToRequest.join(", ")}`);
      } catch (error) {
        // Extract more information from the error
        if (error instanceof Error) {
          core.error(`Error requesting reviews: ${error.message}`);
          if ('status' in error) {
            core.error(`Status code: ${(error as any).status}`);
          }
          
          // Check PR status
          core.info(`PR state: ${pullRequest.state}, Draft: ${pullRequest.draft === true ? 'Yes' : 'No'}`);
          
          // Try with a smaller batch - just one reviewer
          if (reviewersToRequest.length > 1) {
            core.info('Trying with a single reviewer instead of multiple...');
            try {
              const singleReviewer = reviewersToRequest[0];
              await octokit.request(`POST /repos/${repo.owner}/${repo.repo}/pulls/${pullNumber}/requested_reviewers`, {
                reviewers: [singleReviewer],
              });
              core.info(`Successfully requested review from: ${singleReviewer}`);
            } catch (singleError) {
              if (singleError instanceof Error) {
                core.error(`Single reviewer request also failed: ${singleError.message}`);
              }
              throw error; // Re-throw the original error
            }
          } else {
            throw error;
          }
        } else {
          throw error;
        }
      }
    }
  } catch (error) {
    if (error instanceof Error) {
      core.setFailed(error.message);
    } else {
      core.setFailed(`Unknown error: ${error}`);
    }
  }
}

run();

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
    const debugMode = core.getInput("debug") === "true";

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

    let repo: { owner: string; repo: string };
    let pullNumber: number;

    if (debugMode) {
      // Use provided repo and PR number in debug mode
      core.info("Running in debug mode with manually provided repository and PR information");
      
      const repoInput = core.getInput("repo");
      if (!repoInput) {
        throw new Error("In debug mode, 'repo' input is required (format: 'owner/repo')");
      }
      
      const [repoOwner, repoName] = repoInput.split("/");
      if (!repoOwner || !repoName) {
        throw new Error(`Invalid repo format. Expected 'owner/repo', got '${repoInput}'`);
      }
      
      repo = { owner: repoOwner, repo: repoName };
      
      const prNumberInput = core.getInput("pr_number");
      if (!prNumberInput) {
        throw new Error("In debug mode, 'pr_number' input is required");
      }
      
      pullNumber = Number.parseInt(prNumberInput);
      if (isNaN(pullNumber)) {
        throw new Error(`Invalid PR number: ${prNumberInput}`);
      }

      core.info(`Debug mode: Using repository ${repo.owner}/${repo.repo} and PR #${pullNumber}`);
    } else {
      // Normal mode: Use GitHub context
      // Ensure we're in a pull request context
      if (!context.payload.pull_request) {
        throw new Error("This action can only be run on pull request events");
      }

      pullNumber = context.payload.pull_request.number;
      repo = context.repo;
    }

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

    // Filter out PR author and existing reviewers
    const prAuthor = pullRequest.user?.login;
    const eligibleReviewers = teamMembers
      .filter((member) => member.login !== prAuthor)
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
      console.log(`Found ${teamMembers.length} team members in ${owner}/${team}`);
      console.log(`Eligible reviewers: ${eligibleReviewers.length}`);
      console.log(`Attempting to request reviews from: ${reviewersToRequest.join(", ")}`);
      console.log(`API call parameters: PR #${pullNumber} in ${repo.owner}/${repo.repo}`);
      
      try {
        // Print raw GitHub context for debugging
        console.log('GitHub context:', JSON.stringify(github.context, null, 2));
        console.log('Using repo structure:', JSON.stringify(repo, null, 2));
        
        // This could be a pull request permissions issue or API endpoint issue
        // Let's try a completely different approach: add the team as a reviewer directly
        
        console.log(`Trying to request team as reviewer instead of individual users`);
        
        try {
          // Try adding the entire team as a reviewer
          await octokit.request('POST /repos/{owner}/{repo}/pulls/{pull_number}/requested_reviewers', {
            owner: repo.owner,
            repo: repo.repo,
            pull_number: pullNumber,
            team_reviewers: [team], // Use team_reviewers parameter instead
          });
          console.log(`Successfully requested team reviewer: ${team}`);
        } catch (teamError) {
          console.log(`Team reviewer request failed: ${teamError instanceof Error ? teamError.message : 'Unknown error'}`);
          console.log('Falling back to individual user request...');
          
          // Try with standard individual requests again but with base URL verification
          const baseUrl = octokit.request.endpoint.DEFAULTS.baseUrl; // Get the actual base URL being used
          console.log(`Octokit base URL: ${baseUrl}`);
          
          await octokit.request('POST /repos/{owner}/{repo}/pulls/{pull_number}/requested_reviewers', {
            owner: repo.owner,
            repo: repo.repo,
            pull_number: pullNumber,
            reviewers: reviewersToRequest.slice(0, 1), // Try with just one reviewer
          });
        }

        core.info(
          `Successfully requested reviews from: ${reviewersToRequest.join(", ")}`,
        );
      } catch (error) {
        if (error instanceof Error) {
          core.error(`Failed to request reviews: ${error.message}`);
          
          // Validate PR exists
          try {
            core.info("Checking if PR exists...");
            const { data: pr } = await octokit.rest.pulls.get({
              owner: repo.owner,
              repo: repo.repo,
              pull_number: pullNumber,
            });
            core.info(`PR #${pullNumber} exists with title: ${pr.title}`);
          } catch (prError) {
            if (prError instanceof Error) {
              core.error(`PR validation failed: ${prError.message}`);
            }
          }
          
          // Check token permissions
          try {
            core.info("Checking authenticated user...");
            const { data: user } = await octokit.rest.users.getAuthenticated();
            core.info(`Authenticated as ${user.login}`);
          } catch (authError) {
            if (authError instanceof Error) {
              core.error(`Auth validation failed: ${authError.message}`);
            }
          }
        }
        throw error;
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

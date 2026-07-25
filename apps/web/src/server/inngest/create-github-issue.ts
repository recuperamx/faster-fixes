import {
  formatIssueBody,
  formatIssueTitle,
} from "@/server/github/format-issue-body";
import { getInstallationOctokit } from "@/server/github/github-app";
import type { DiagnosticTrail } from "@fasterfixes/core";
import { getSignedAssetUrl } from "@/server/storage/get-signed-asset-url";
import { prisma } from "@workspace/db";
import { inngest } from "./index";

// Observed in staging: ~3s for the widget's full-quality capture, a fallback
// capture if that is too slow, then ~2.5s to upload. 30s is generous headroom
// without stalling the issue for long when no screenshot ever arrives.
const SCREENSHOT_WAIT_TIMEOUT = "30s";

export const createGitHubIssue = inngest.createFunction(
  {
    id: "create-github-issue",
    retries: 3,
    concurrency: { key: "event.data.feedbackId", limit: 1 },
    triggers: [
      { event: "feedback/created" },
      {
        event: "feedback/integration-issue-requested",
        if: "event.data.target == 'github'",
      },
    ],
  },
  async ({ event, step }) => {
    const { feedbackId } = event.data;

    // The widget calls `uploadScreenshotInBackground` *without* awaiting it, so
    // `feedback/created` routinely arrives a couple of seconds before the
    // screenshot exists. Creating the issue immediately produced a body with no
    // screenshot at all, silently.
    //
    // Read the decision inside a step so it is memoized: Inngest replays this
    // function after the wait, and branching on a live DB read would flip the
    // condition between replays and desynchronise the step sequence.
    const shouldWaitForScreenshot = await step.run(
      "needs-screenshot-wait",
      async () => {
        // Only the automatic path races. A manual request happens long after
        // upload would have finished, and must not stall on a screenshot that
        // is never coming.
        if (event.name !== "feedback/created") return false;

        const pending = await prisma.feedback.findUnique({
          where: { id: feedbackId },
          select: {
            screenshotId: true,
            issueLink: { select: { id: true } },
            project: {
              select: { gitHubLink: { select: { id: true } } },
            },
          },
        });

        // Nothing to wait for if it already arrived, there is no repo linked,
        // or an issue already exists.
        return Boolean(
          pending &&
            !pending.screenshotId &&
            !pending.issueLink &&
            pending.project.gitHubLink,
        );
      },
    );

    if (shouldWaitForScreenshot) {
      // Bounded: the screenshot is best-effort and the widget can legitimately
      // give up, so time out and post without it rather than never posting.
      await step.waitForEvent("await-screenshot", {
        event: "feedback/screenshot-attached",
        match: "data.feedbackId",
        timeout: SCREENSHOT_WAIT_TIMEOUT,
      });
    }

    const feedback = await prisma.feedback.findUnique({
      where: { id: feedbackId },
      include: {
        project: {
          include: {
            gitHubLink: {
              include: { gitHubInstallation: true },
            },
          },
        },
        reviewer: { select: { name: true } },
        screenshot: { select: { key: true, bucket: true } },
        issueLink: { select: { id: true } },
      },
    });

    if (!feedback) return { skipped: "feedback_not_found" };

    // Handler-level idempotency closes the duplicate-issue footgun: any future
    // emit of `feedback/created` (backfills, admin re-triggers) will short-circuit
    // here instead of creating a second GH issue.
    if (feedback.issueLink) {
      return { skipped: "github_issue_already_exists" };
    }

    const gitHubLink = feedback.project.gitHubLink;
    if (!gitHubLink) return { skipped: "no_github_link" };

    // Auto-create only on `feedback/created`. Manual trigger
    // (`feedback/integration-issue-requested`) bypasses the auto-create switch.
    const isManualTrigger =
      event.name === "feedback/integration-issue-requested";
    if (!isManualTrigger && !gitHubLink.autoCreateIssues) {
      return { skipped: "auto_create_disabled" };
    }

    const installation = gitHubLink.gitHubInstallation;
    const octokit = getInstallationOctokit(installation.installationId);

    let screenshotUrl: string | null = null;
    if (feedback.screenshot) {
      screenshotUrl = await getSignedAssetUrl(feedback.screenshot, 3600);
    }

    const baseUrl = process.env.BETTER_AUTH_URL ?? process.env.BASE_URL!;
    const dashboardUrl = `${baseUrl}/inbox?feedbackId=${feedback.id}`;

    const title = formatIssueTitle(feedback.comment);
    const body = formatIssueBody({
      id: feedback.id,
      comment: feedback.comment,
      pageUrl: feedback.pageUrl,
      selector: feedback.selector,
      clickX: feedback.clickX,
      clickY: feedback.clickY,
      browserName: feedback.browserName,
      browserVersion: feedback.browserVersion,
      os: feedback.os,
      viewportWidth: feedback.viewportWidth,
      viewportHeight: feedback.viewportHeight,
      screenshotUrl,
      reviewerName: feedback.reviewer.name,
      metadata: feedback.metadata as Record<string, unknown> | null,
      diagnosticTrail: feedback.diagnosticTrail as DiagnosticTrail | null,
      projectId: feedback.projectId,
      dashboardUrl,
    });

    const response = await octokit.request(
      "POST /repos/{owner}/{repo}/issues",
      {
        owner: gitHubLink.repoOwner,
        repo: gitHubLink.repoName,
        title,
        body,
        labels: gitHubLink.defaultLabels,
      },
    );

    const issue = response.data as {
      number: number;
      html_url: string;
      node_id: string;
    };

    await prisma.feedbackIssueLink.create({
      data: {
        feedbackId: feedback.id,
        projectGitHubLinkId: gitHubLink.id,
        issueNumber: issue.number,
        issueUrl: issue.html_url,
        issueState: "open",
        issueNodeId: issue.node_id,
        lastSyncSource: "app",
        lastSyncAt: new Date(),
      },
    });

    return { issueNumber: issue.number, issueUrl: issue.html_url };
  },
);

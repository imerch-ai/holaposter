import { createPublishWorker } from "./queue";

const worker = createPublishWorker();

worker.on("completed", (job) => {
  console.info("publish_job_completed", { jobId: job.id, post_id: job.data.post_id });
});

worker.on("failed", (job, error) => {
  console.error("publish_job_failed", {
    jobId: job?.id,
    post_id: job?.data.post_id,
    error: error.message
  });
});

console.info("postsyncer worker started");

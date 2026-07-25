import { aws, cloudflare, custom } from "@better-upload/server/clients";

// RECUPERA FORK PATCH: upstream hardcoded the Cloudflare R2 client, so a
// self-hosted instance could only ever use R2 — despite the docs claiming
// "AWS S3 works identically". Recupera already has S3-compatible storage and
// credentials provisioned for the API, so pick the client from the environment
// instead of forcing a second, redundant storage account.
//
// Resolution order:
//   1. An explicit endpoint (AWS_S3_ENDPOINT) -> generic S3. Covers real AWS
//      with a custom endpoint, R2's S3 API, MinIO and LocalStack.
//   2. R2_ACCOUNT_ID -> the native R2 client (upstream's behaviour).
//   3. Otherwise -> plain AWS S3, where the region alone locates the endpoint.
//
// Credentials fall back across the AWS_* and R2_* spellings so either set works.
function createStorageClient() {
  const accessKeyId =
    process.env.AWS_ACCESS_KEY_ID ?? process.env.R2_ACCESS_KEY_ID;
  const secretAccessKey =
    process.env.AWS_SECRET_ACCESS_KEY ?? process.env.R2_SECRET_ACCESS_KEY;

  // R2 wants "auto"; real AWS needs its actual region, so prefer the AWS vars.
  const region =
    process.env.AWS_DEFAULT_REGION ??
    process.env.AWS_REGION ??
    process.env.STORAGE_REGION ??
    "auto";

  const endpoint = process.env.AWS_S3_ENDPOINT ?? process.env.AWS_ENDPOINT_URL;

  if (!accessKeyId || !secretAccessKey) {
    throw new Error(
      "Object storage is not configured. Set AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY (or the R2_* equivalents).",
    );
  }

  if (endpoint) {
    // `custom` wants a bare host, so split off the scheme.
    const { host, protocol } = new URL(endpoint);
    return custom({
      host,
      secure: protocol === "https:",
      region,
      accessKeyId,
      secretAccessKey,
      // Path style avoids depending on virtual-host DNS, which varies between
      // S3-compatible providers and does not exist at all on LocalStack/MinIO.
      forcePathStyle: true,
    });
  }

  if (process.env.R2_ACCOUNT_ID) {
    return cloudflare({
      accountId: process.env.R2_ACCOUNT_ID,
      accessKeyId,
      secretAccessKey,
    });
  }

  return aws({ accessKeyId, secretAccessKey, region });
}

export const s3Client = createStorageClient();

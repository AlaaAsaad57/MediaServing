const {
  S3Client,
  GetObjectCommand,
  PutObjectCommand,
  HeadObjectCommand,
} = require("@aws-sdk/client-s3");
const { Upload } = require("@aws-sdk/lib-storage");
let s3;
if (process.env.NODE_ENV !== "production") {
  s3 = new S3Client({
    endpoint: process.env.S3_ENDPOINT,
    region: process.env.S3_REGION || "us-east-1",
    credentials: {
      accessKeyId: process.env.S3_ACCESS_KEY,
      secretAccessKey: process.env.S3_SECRET_KEY,
    },
    forcePathStyle: true,
  });
} else {
  s3 = new S3Client({
    region: process.env.S3_REGION || "us-east-1",
    credentials: {
      accessKeyId: process.env.S3_ACCESS_KEY,
      secretAccessKey: process.env.S3_SECRET_KEY,
    },
    forcePathStyle: true,
  });
}

const BUCKET = process.env.S3_BUCKET || "media";

/**
 * Fetch an object as a stream, optionally a byte range.
 *
 * The range argument lets the delivery route serve partial content without
 * pulling the whole object into memory first. Callers that pass no options get
 * exactly the previous behaviour.
 */
async function getObjectStream(key, opts = {}) {
  const command = new GetObjectCommand({
    Bucket: BUCKET,
    Key: key,
    ...(opts.range ? { Range: opts.range } : {}),
  });
  const response = await s3.send(command);
  return response;
}

async function getObjectBuffer(key, opts = {}) {
  const command = new GetObjectCommand({
    Bucket: BUCKET,
    Key: key,
    ...(opts.range ? { Range: opts.range } : {}),
  });
  const response = await s3.send(command);
  const chunks = [];
  for await (const chunk of response.Body) {
    chunks.push(chunk);
  }
  return {
    buffer: Buffer.concat(chunks),
    contentType: response.ContentType,
    contentLength: response.ContentLength,
    contentRange: response.ContentRange,
    etag: response.ETag,
  };
}

async function getObjectMetadata(key) {
  const response = await s3.send(
    new HeadObjectCommand({ Bucket: BUCKET, Key: key }),
  );

  return {
    contentLength: response.ContentLength,
    contentType: response.ContentType,
    etag: response.ETag,
    // User metadata (`user-type`, `original-name`, …). S3 lowercases the keys.
    // Added for the chat download route, which reads the original filename from
    // it; existing callers destructure the fields above and are unaffected.
    metadata: response.Metadata,
  };
}

/**
 * Write an object, optionally with S3 user metadata.
 *
 * `metadata` carries upload attribution (`user-type`, `user-id`, `ticket-jti`,
 * `uploaded-at`) so a stored object stays traceable to a person for as long as
 * it exists — logs expire, objects do not. Keys and values must be ASCII; the
 * caller is responsible for that. Omitting the argument writes no metadata,
 * which is exactly the previous behaviour.
 */
async function putObject(key, buffer, contentType, metadata) {
  const command = new PutObjectCommand({
    Bucket: BUCKET,
    Key: key,
    Body: buffer,
    ContentType: contentType,
    ...(metadata ? { Metadata: metadata } : {}),
  });
  return s3.send(command);
}

/**
 * Stream an arbitrarily large body to S3 using a multipart upload.
 *
 * Unlike `putObject` (which needs the whole buffer in memory), this consumes a
 * Readable stream and uploads it in bounded-size parts, so memory stays flat
 * (~partSize × queueSize) no matter how large the file is. Used for huge
 * uploads such as Excel exports. On any stream/upload error the SDK aborts the
 * in-flight multipart upload, so no partial object is left behind.
 */
async function uploadStream(key, body, contentType, metadata) {
  const partSizeMb = Number.parseInt(process.env.S3_UPLOAD_PART_SIZE_MB || "8", 10);
  const upload = new Upload({
    client: s3,
    params: {
      Bucket: BUCKET,
      Key: key,
      Body: body,
      ContentType: contentType,
      ...(metadata ? { Metadata: metadata } : {}),
    },
    queueSize: Number.parseInt(process.env.S3_UPLOAD_CONCURRENCY || "4", 10),
    partSize: Math.max(partSizeMb, 5) * 1024 * 1024, // S3 minimum part size is 5 MB
    leavePartsOnError: false,
  });
  return upload.done();
}

async function objectExists(key) {
  try {
    await s3.send(new HeadObjectCommand({ Bucket: BUCKET, Key: key }));
    return true;
  } catch (err) {
    if (err.name === "NotFound" || err.$metadata?.httpStatusCode === 404) {
      return false;
    }
    throw err;
  }
}

module.exports = {
  s3,
  BUCKET,
  getObjectStream,
  getObjectBuffer,
  getObjectMetadata,
  putObject,
  uploadStream,
  objectExists,
};

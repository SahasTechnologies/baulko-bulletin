import { test } from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";

process.env.IMAGEKIT_PRIVATE_KEY = "test-private-key";
process.env.IMAGEKIT_PUBLIC_KEY = "public-test-key";
process.env.IMAGEKIT_URL_ENDPOINT = "https://ik.imagekit.io/demo";
delete process.env.IMAGEKIT_UPLOAD_ENDPOINT;

import {
  filePathFromImageKitUrl,
  imageKitConfigured,
  imageKitUrlEndpoint,
  uploadAuth,
  uploadEndpoint,
  uploadFolder,
} from "./imagekit.ts";

test("ImageKit configuration and folder routing use the expected environment", () => {
  assert.equal(imageKitConfigured(), true);
  assert.equal(uploadFolder("image"), "/bulletin");
  assert.equal(uploadFolder("pdf"), "/bulletin/pdfs");
  assert.equal(uploadEndpoint(), "https://upload.imagekit.io/api/v1/files/upload");
  assert.equal(imageKitUrlEndpoint(), "https://ik.imagekit.io/demo");
});

test("uploadAuth creates a short-lived signed payload with the public key", () => {
  const auth = uploadAuth();
  assert.ok(auth);
  assert.equal(auth.publicKey, "public-test-key");
  assert.ok(auth.expire > Math.floor(Date.now() / 1000));
  assert.match(auth.token, /^[0-9a-f-]{36}$/);
  assert.equal(
    auth.signature,
    createHmac("sha1", "test-private-key").update(`${auth.token}${auth.expire}`).digest("hex"),
  );
});

test("filePathFromImageKitUrl accepts only the configured account and removes transforms", () => {
  assert.equal(
    filePathFromImageKitUrl("https://ik.imagekit.io/demo/bulletin/cover.jpg?tr=w-2000,h-1000"),
    "/bulletin/cover.jpg",
  );
  assert.equal(filePathFromImageKitUrl("https://ik.imagekit.io/other/bulletin/cover.jpg"), null);
  assert.equal(filePathFromImageKitUrl("https://ik.imagekit.io/demo/other/cover.jpg"), "/other/cover.jpg");
  assert.equal(filePathFromImageKitUrl("https://example.com/bulletin/cover.jpg"), null);
  assert.equal(filePathFromImageKitUrl(null), null);
  assert.equal(filePathFromImageKitUrl("not a URL"), null);
});

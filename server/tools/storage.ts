import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3'

function getClient(): S3Client | null {
  const { AWS_REGION, S3_BUCKET, AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY } = process.env
  if (!AWS_REGION || !S3_BUCKET || !AWS_ACCESS_KEY_ID || !AWS_SECRET_ACCESS_KEY) return null
  return new S3Client({
    region: AWS_REGION,
    credentials: { accessKeyId: AWS_ACCESS_KEY_ID, secretAccessKey: AWS_SECRET_ACCESS_KEY },
  })
}

export async function uploadToS3(buffer: Buffer, key: string, contentType: string): Promise<string | null> {
  const client = getClient()
  if (!client) return null
  try {
    await client.send(new PutObjectCommand({
      Bucket: process.env.S3_BUCKET!,
      Key: key,
      Body: buffer,
      ContentType: contentType,
    }))
    return `https://${process.env.S3_BUCKET}.s3.${process.env.AWS_REGION}.amazonaws.com/${key}`
  } catch (e: unknown) {
    console.error('[S3] Upload error:', e instanceof Error ? e.message : String(e))
    return null
  }
}

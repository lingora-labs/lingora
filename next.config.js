/** @type {import('next').NextConfig} */
const nextConfig = {
  serverExternalPackages: ['openai', 'pdf-lib', '@aws-sdk/client-s3', '@aws-sdk/client-rekognition'],
}

module.exports = nextConfig

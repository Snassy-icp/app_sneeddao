import dotenv from 'dotenv';
import path from 'path';
import fs from 'fs';

export default async function globalSetup() {
  // Check if .env file exists
  const envPath = path.resolve(__dirname, '../.env');
  if (fs.existsSync(envPath)) {
    // If .env exists, load it
    dotenv.config({ path: envPath });
    console.log('Loaded environment variables from .env file');
  } else {
    console.log('No .env file found, using existing environment variables');
  }
}
const axios = require('axios');
const fs = require('fs').promises;
const path = require('path');
const { getSupabaseClient } = require('../config/supabase');
const logger = require('../shared/utils/logger');

const REMOTE_ASSET_TIMEOUT_MS = parseInt(process.env.PDF_ASSET_TIMEOUT_MS || '', 10) || 15000;
const REMOTE_ASSET_RETRIES = parseInt(process.env.PDF_ASSET_RETRIES || '', 10) || 3;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function withTimeout(promise, timeoutMs, label) {
  let timeoutId;
  const timeoutPromise = new Promise((_, reject) => {
    timeoutId = setTimeout(() => {
        const error = new Error(`${label} timed out after ${timeoutMs}ms`);
        error.code = 'PDF_ASSET_TIMEOUT';
        reject(error);
    }, timeoutMs);
  });

  return Promise.race([promise, timeoutPromise])
    .finally(() => clearTimeout(timeoutId));
}

function isHttpUrl(value) {
  return String(value || '').startsWith('http://') || String(value || '').startsWith('https://');
}

function parseSupabasePublicStorageUrl(urlOrPath) {
  try {
    const parsedUrl = new URL(urlOrPath);
    const marker = '/storage/v1/object/public/';
    const markerIndex = parsedUrl.pathname.indexOf(marker);
    if (markerIndex === -1) {
      return null;
    }

    const publicPath = parsedUrl.pathname.slice(markerIndex + marker.length);
    const [bucket, ...objectPathParts] = publicPath.split('/').filter(Boolean);
    const objectPath = objectPathParts.join('/');

    if (!bucket || !objectPath) {
      return null;
    }

    return {
      bucket: decodeURIComponent(bucket),
      objectPath: decodeURIComponent(objectPath)
    };
  } catch (error) {
    return null;
  }
}

async function loadSupabaseStorageAsset(urlOrPath) {
  const storageRef = parseSupabasePublicStorageUrl(urlOrPath);
  if (!storageRef) {
    return null;
  }

  const supabase = getSupabaseClient();
  if (!supabase) {
    return null;
  }

  const { data, error } = await supabase.storage
    .from(storageRef.bucket)
    .download(storageRef.objectPath);

  if (error) {
    throw error;
  }

  return Buffer.from(await data.arrayBuffer());
}

async function loadRemoteAsset(urlOrPath) {
  let lastError = null;

  for (let attempt = 1; attempt <= REMOTE_ASSET_RETRIES; attempt += 1) {
    try {
      const response = await axios.get(urlOrPath, {
        responseType: 'arraybuffer',
        timeout: REMOTE_ASSET_TIMEOUT_MS,
        maxRedirects: 5,
        headers: {
          'User-Agent': 'backend-rh-pdf-generator/1.0'
        }
      });

      return Buffer.from(response.data);
    } catch (error) {
      lastError = error;
      if (attempt < REMOTE_ASSET_RETRIES) {
        await sleep(350 * attempt);
      }
    }
  }

  throw lastError;
}

/**
 * Downloads a remote image or loads a local image as a Buffer.
 * Gracefully returns null on failure instead of throwing.
 * 
 * @param {string} urlOrPath - The HTTP URL or local filepath of the asset
 * @returns {Promise<Buffer|null>} - Buffer of the asset, or null if loading failed
 */
async function loadAsset(urlOrPath) {
  if (!urlOrPath) {
    return null;
  }

  try {
    // Case 1: Remote HTTP/HTTPS URL
    if (isHttpUrl(urlOrPath)) {
      try {
        const storageBuffer = await withTimeout(
          loadSupabaseStorageAsset(urlOrPath),
          REMOTE_ASSET_TIMEOUT_MS,
          'Supabase PDF asset download'
        );
        if (storageBuffer) {
          return storageBuffer;
        }
      } catch (storageError) {
        logger.logError('PDF_ASSETS', `Error loading Supabase PDF asset from "${urlOrPath}"`, storageError);
      }

      return await loadRemoteAsset(urlOrPath);
    }

    // Case 2: Absolute file path
    if (path.isAbsolute(urlOrPath)) {
      await fs.access(urlOrPath);
      return await fs.readFile(urlOrPath);
    }

    // Case 3: Relative file path (relative to project root)
    const projectRootPath = path.resolve(__dirname, '../..', urlOrPath);
    try {
      await fs.access(projectRootPath);
      return await fs.readFile(projectRootPath);
    } catch (err) {
      // Try resolving relative to public or src folder as secondary fallback
      const publicPath = path.resolve(__dirname, '../../public', urlOrPath);
      await fs.access(publicPath);
      return await fs.readFile(publicPath);
    }
  } catch (error) {
    logger.logError('PDF_ASSETS', `Error loading PDF asset from "${urlOrPath}"`, error);
    return null;
  }
}

module.exports = {
  loadAsset
};

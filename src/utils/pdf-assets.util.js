const axios = require('axios');
const fs = require('fs').promises;
const path = require('path');
const logger = require('../shared/utils/logger');

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
    if (urlOrPath.startsWith('http://') || urlOrPath.startsWith('https://')) {
      const response = await axios.get(urlOrPath, {
        responseType: 'arraybuffer',
        timeout: 5000 // 5 seconds timeout
      });
      return Buffer.from(response.data);
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

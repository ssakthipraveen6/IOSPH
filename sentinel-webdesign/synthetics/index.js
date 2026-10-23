/**
 * synthetics/index.js
 *
 * Project Sentinel Synthetics & Golden Journeys Package Entry Point.
 */

const { JourneyRunner, getGlobalRunner } = require('./runner');
const { generateTraceId, generateSpanId, createSpan } = require('./trace');
const { executeHttpStep } = require('./steps/http');
const { executeBrowserStep } = require('./steps/browser');
const { executeGitStep } = require('./steps/git');
const { executeUploadDownloadStep } = require('./steps/upload_download');

module.exports = {
  JourneyRunner,
  getGlobalRunner,
  generateTraceId,
  generateSpanId,
  createSpan,
  executeHttpStep,
  executeBrowserStep,
  executeGitStep,
  executeUploadDownloadStep
};

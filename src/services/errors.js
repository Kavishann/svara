// Only fixed, application-owned messages cross IPC. Provider responses can contain secrets.
const names = { stt: 'Chirp 2 listening', tts: 'Gemini speech', gemini: 'Gemini translation', jev: 'TypeSafe Jev' };
const apis = {
  'aiplatform.googleapis.com': 'Agent Platform / Vertex AI API (aiplatform.googleapis.com)',
  'texttospeech.googleapis.com': 'Cloud Text-to-Speech API',
  'speech.googleapis.com': 'Cloud Speech-to-Text API',
  'generativelanguage.googleapis.com': 'Gemini API'
};

export class ServiceError extends Error {
  constructor(message) { super(message); this.name = 'ServiceError'; }
}

export function serviceError(kind, error) {
  if (error instanceof ServiceError || error?.name === 'AbortError') return error;
  const name = names[kind] || 'The service';
  const message = [error?.message, error?.details, error?.error?.message, error?.response?.data?.error?.message,
    JSON.stringify(error?.errorInfo || {}), JSON.stringify(error?.statusDetails || [])].filter(Boolean).join(' ');
  const code = Number(error?.status || error?.statusCode || error?.code);
  let detail;
  if (/SERVICE_DISABLED|API.*(?:not been used|disabled)|accessNotConfigured/i.test(message)) {
    const api = Object.keys(apis).find(id => message.includes(id));
    detail = `Enable ${api ? apis[api] : 'the required API'} in your Google Cloud project, then retry after a few minutes.`;
  } else if (/BILLING_DISABLED|billing.*(?:disabled|not enabled|not active|not found)/i.test(message)) {
    detail = 'Google Cloud billing is not enabled for this project. Review its billing setup.';
  } else if (/prepayment credits.*(?:depleted|exhausted)|prepaid.*(?:depleted|exhausted|insufficient)/i.test(message)) {
    detail = 'Google reports that prepaid credits are depleted. Review the project’s billing and credit balance in Google AI Studio.';
  } else if (code === 429 || code === 8 || /quota|RESOURCE_EXHAUSTED|rate.limit|insufficient.*(?:credit|balance)/i.test(message)) {
    detail = kind === 'jev' ? 'Usage limit reached. Check your TypeSafe credits and rate limits.'
      : kind === 'gemini' ? 'Usage limit reached. Check this model’s quota and billing in Google AI Studio.'
        : 'Usage limit reached. Check this API’s quota and billing in Google Cloud.';
  } else if (/default credentials|ENOENT|invalid_grant|invalid.jwt|invalid_client|private.key|could not load.*credential/i.test(message)) {
    detail = 'The Google Cloud credential file is missing or invalid. Select a valid service-account JSON in Connections, or configure Application Default Credentials.';
  } else if (code === 401 || code === 16 || /UNAUTHENTICATED|API_KEY_INVALID|api.key.*(?:invalid|expired)|unauthorized/i.test(message)) {
    detail = kind === 'jev' ? 'The TypeSafe API key was rejected. Check it in Connections.'
      : kind === 'gemini' ? 'The Gemini API key was rejected. Check it in Connections.'
        : 'Google rejected the Cloud credentials. Check the selected credential file in Connections.';
  } else if (code === 403 || code === 7 || /PERMISSION_DENIED|permission|forbidden/i.test(message)) {
    detail = kind === 'tts' ? 'The Google service account lacks access to speech generation. Check aiplatform.endpoints.predict permission (Vertex AI User) on this project.'
      : kind === 'stt' ? 'The Google service account lacks speech recognition access. Check its Speech Client role on this project.'
        : kind === 'gemini' ? 'The Gemini API key cannot access this model. Check its project and API restrictions in Google AI Studio.'
          : 'The TypeSafe key cannot access Jev. Check its organization and model access.';
  } else if (code === 404 || code === 5 || /NOT_FOUND|model.*not.*(?:found|supported)/i.test(message)) {
    detail = 'The requested model or location is unavailable. Check model access and the selected region.';
  } else if (code === 408 || code === 504 || code === 4 || /timeout|deadline|ETIMEDOUT/i.test(message)) {
    detail = 'The request took too long. Please retry; your reading position is saved.';
  } else if (code === 503 || code === 14 || /fetch failed|ENOTFOUND|ECONN|UNAVAILABLE/i.test(message)) {
    detail = 'The service could not be reached. Check your internet connection and try again.';
  } else if (/JSON|Unexpected token|structured|ZodError/i.test(message) || error?.name === 'SyntaxError') {
    detail = 'The response could not be understood. Please try again.';
  } else {
    detail = 'The request failed. Check this service in Connections and try again.';
  }
  return new ServiceError(`${name}: ${detail}`);
}

export async function withService(kind, fn) {
  try { return await fn(); } catch (error) { throw serviceError(kind, error); }
}

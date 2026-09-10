class AppError extends Error {
  constructor(code, message, status = 400) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

const ERRORS = {
  INVALID_URL: (detail = 'Le lien n’est pas reconnu.') =>
    new AppError('INVALID_URL', detail, 400),
  PLATFORM_UNSUPPORTED: () =>
    new AppError('PLATFORM_UNSUPPORTED', 'Cette plateforme n’est pas encore prise en charge.', 400),
  VIDEO_PRIVATE: () =>
    new AppError('VIDEO_PRIVATE', 'Cette vidéo est privée ou nécessite une connexion.', 403),
  VIDEO_REMOVED: () =>
    new AppError('VIDEO_REMOVED', 'Cette vidéo a été supprimée ou est introuvable.', 404),
  EXTRACTION_FAILED: () =>
    new AppError('EXTRACTION_FAILED', 'Impossible d’extraire la vidéo. Réessayez dans un instant.', 422),
  RATE_LIMITED: () =>
    new AppError('RATE_LIMITED', 'Trop de requêtes. Patientez quelques secondes.', 429),
  FILE_TOO_LARGE: () =>
    new AppError('FILE_TOO_LARGE', 'Le fichier dépasse la taille maximale autorisée.', 413),
};

function mapYtdlpError(err) {
  const raw = String(err?.message || err || '');
  const msg = raw.toLowerCase();
  if (msg.includes('timeout')) {
    return new AppError('EXTRACTION_FAILED', 'L’analyse a pris trop de temps. Réessayez.', 422);
  }
  if (
    msg.includes('private') ||
    msg.includes('login') ||
    msg.includes('sign in') ||
    msg.includes('logged-in') ||
    msg.includes('cookies') ||
    msg.includes('not a bot')
  ) {
    return ERRORS.VIDEO_PRIVATE();
  }
  if (msg.includes('404') || msg.includes('unavailable') || msg.includes('removed') || msg.includes('not found')) {
    return ERRORS.VIDEO_REMOVED();
  }
  if (msg.includes('429') || msg.includes('rate')) {
    return ERRORS.RATE_LIMITED();
  }
  return ERRORS.EXTRACTION_FAILED();
}

module.exports = { AppError, ERRORS, mapYtdlpError };

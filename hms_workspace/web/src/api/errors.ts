export class NotFoundError extends Error {
  constructor() {
    super('not-found');
    this.name = 'NotFoundError';
  }
}

/** The live API has no endpoint for this; the UI says so instead of showing synthetic data. */
export class LiveUnsupportedError extends Error {
  constructor() {
    super('live-unsupported');
    this.name = 'LiveUnsupportedError';
  }
}

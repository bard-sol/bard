/** Pixi's isMobile reads globalThis.navigator while the module is imported. Node 20 has no navigator. */
if (typeof globalThis.navigator === 'undefined') {
  Object.defineProperty(globalThis, 'navigator', {
    value: {
      userAgent: 'node',
      platform: 'node',
      maxTouchPoints: 0,
      language: 'en',
      languages: ['en'],
    },
    configurable: true,
    writable: true,
  });
}

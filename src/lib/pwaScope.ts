const POS_SERVICE_WORKER_PATH = '/pos-sw.js';

function isPosServiceWorker(scriptUrl: string | undefined): boolean {
    if (!scriptUrl) return false;
    try {
        return new URL(scriptUrl).pathname === POS_SERVICE_WORKER_PATH;
    } catch {
        return false;
    }
}

/**
 * Earlier POS builds registered pos-sw.js for `/`, which let the offline POS
 * cache control the back-office SPA too. Remove only that legacy registration;
 * the current POS worker is registered with the narrow `/pos.html` scope.
 */
export async function unregisterLegacyRootPosWorker(): Promise<{
    removed: boolean;
    wasControllingPage: boolean;
}> {
    if (typeof window === 'undefined' || !('serviceWorker' in navigator)) {
        return { removed: false, wasControllingPage: false };
    }

    const rootScope = new URL('/', window.location.origin).href;
    const registrations = await navigator.serviceWorker.getRegistrations();
    const legacy = registrations.filter((registration) => {
        if (registration.scope !== rootScope) return false;
        return [registration.active, registration.waiting, registration.installing]
            .some((worker) => isPosServiceWorker(worker?.scriptURL));
    });

    if (legacy.length === 0) {
        return { removed: false, wasControllingPage: false };
    }

    const wasControllingPage = isPosServiceWorker(navigator.serviceWorker.controller?.scriptURL);
    const results = await Promise.all(legacy.map((registration) => registration.unregister()));
    return { removed: results.some(Boolean), wasControllingPage };
}

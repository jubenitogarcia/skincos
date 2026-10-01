type BeautyMovementLocalPreviewEnvironment = {
    isProduction: boolean;
};

export function isBeautyMovementLocalPreviewAllowed({
    isProduction,
}: BeautyMovementLocalPreviewEnvironment): boolean {
    // A Host header cannot prove that a request reached the machine through a
    // loopback interface. Keep this fixture entirely outside production builds;
    // local development remains available without a feature flag or customer data.
    return !isProduction;
}

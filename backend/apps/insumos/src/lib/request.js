export function getClientIp(request) {
    const skincosIp = request.headers.get('x-skincos-client-ip');
    if (skincosIp && String(skincosIp).trim()) return String(skincosIp).trim();
    return (
        request.headers.get('cf-connecting-ip') ||
        request.headers.get('x-forwarded-for')?.split(',')?.[0]?.trim() ||
        '0.0.0.0'
    );
}

export function getUserAgent(request) {
    return request.headers.get('user-agent') || '';
}

const LOCAL_AUTH_RESET_PARAM = 'localAuthReset'

type BrowserLocation = Pick<Location, 'href' | 'hostname'>

export function consumeLocalAuthReset(
  location: BrowserLocation,
  storage: Pick<Storage, 'removeItem'>,
  clearCookie: (value: string) => void,
  replaceUrl: (url: string) => void,
): boolean {
  const url = new URL(location.href)
  const isLocalHost = ['localhost', '127.0.0.1', '::1'].includes(location.hostname)
  if (!isLocalHost || url.searchParams.get(LOCAL_AUTH_RESET_PARAM) !== '1') return false

  storage.removeItem('crm.localAuth')
  clearCookie('crm.localAuth=; Path=/; Max-Age=0; SameSite=Lax')
  clearCookie('crm_local_auth=; Path=/; Max-Age=0; SameSite=Lax')

  url.searchParams.delete(LOCAL_AUTH_RESET_PARAM)
  replaceUrl(`${url.pathname}${url.search}${url.hash}`)
  return true
}

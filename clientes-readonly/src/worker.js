import { createClientesReadonlyRuntime } from './runtime.js'

export default {
  fetch(request, env) {
    return createClientesReadonlyRuntime(env).fetch(request)
  },
}

// Minimal ambient Next types for local type-check of src/api files
declare module 'next' {
    export interface NextApiRequest { [key: string]: any }
    export interface NextApiResponse<T = any> {
        status: (code: number) => NextApiResponse<T>
        json: (body: T) => void
        setHeader: (name: string, value: string | string[]) => void
        end: (body?: any) => void
    }
}

// Allow process.env typing without bringing full Node types into UI
interface ImportMetaEnv {
    [key: string]: any
}
interface ImportMeta {
    env: ImportMetaEnv
}

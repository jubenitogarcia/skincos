import spark from '@/spark-mock'

// Minimal mockable GraphQL client and hooks to satisfy build/tests
// These implementations are intentionally lightweight and local-only.

export const graphqlClient = {
    async query(query: string, variables?: any): Promise<any> {
        // Very small router based on operation contents
        if (query.includes('objectRecords')) {
            return {
                objectRecords: {
                    edges: [],
                    totalCount: 0
                }
            }
        }
        // Default empty object for unknown queries
        return {}
    }
}

export function useGraphQLQuery(query: string) {
    return {
        async execute(variables?: any): Promise<any[]> {
            // Return empty datasets by default; UI falls back to local state
            if (query.includes('GetObjects') || query.includes('objects')) {
                return []
            }
            return []
        }
    }
}

export function useGraphQLMutation(mutation: string) {
    return {
        async execute(variables?: any): Promise<any> {
            // CreateRecord mutation mock
            if (mutation.includes('CreateRecord') || mutation.includes('createRecord')) {
                const now = new Date().toISOString()
                return {
                    id: `r-${Date.now()}`,
                    objectId: variables?.objectId ?? 'unknown',
                    data: variables?.input?.data ?? {},
                    createdAt: now,
                    updatedAt: now,
                    createdBy: 'mock',
                    updatedBy: 'mock'
                }
            }
            // CreateObject mutation mock
            if (mutation.includes('CreateObject') || mutation.includes('createObject')) {
                const now = new Date().toISOString()
                return {
                    id: `o-${Date.now()}`,
                    recordCount: 0,
                    createdAt: now,
                    updatedAt: now,
                    ...(variables?.input ?? {})
                }
            }
            return {}
        }
    }
}

export const resolvers = {
    Query: {},
    Mutation: {
        async generateAIInsights(_: any, args: { type: string, context: any }) {
            const { type, context } = args
            const id = `${Date.now()}`
            const title = `Insight for ${type}`
            const insight = { id, type, title, context }
            const current = (await spark.kv.get<any[]>('ai-insights')) || []
            current.push(insight)
            await spark.kv.set('ai-insights', current)
            return insight
        }
    }
}

export default { resolvers, graphqlClient, useGraphQLQuery, useGraphQLMutation }

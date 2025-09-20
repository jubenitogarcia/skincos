import { describe, it, expect } from 'vitest'
import { resolvers } from '@/lib/graphql'
import spark from '@/lib/spark-mock'

describe('GraphQL canned insight', () => {
    it('returns a canned AI insight and persists it', async () => {
        // Clear prior insights
        await spark.kv.set('ai-insights', [])

        const result = await (resolvers as any).Mutation.generateAIInsights(null, {
            type: 'PIPELINE_OPTIMIZATION',
            context: { sample: true }
        }, { user: { id: '1', login: 'demo', isOwner: true } })

        expect(result).toBeTruthy()
        expect(result.type).toBe('PIPELINE_OPTIMIZATION')
        expect(result.title).toBeTruthy()
        expect(result.context).toEqual({ sample: true })

        const stored = await spark.kv.get<any[]>('ai-insights')
        expect(Array.isArray(stored)).toBe(true)
        expect(stored!.length).toBeGreaterThan(0)
        expect(stored![0].id).toBe(result.id)
    })
})

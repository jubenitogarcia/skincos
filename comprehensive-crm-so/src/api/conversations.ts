import { NextApiRequest, NextApiResponse } from 'next'
import { toISODateString } from '@/lib/date-utils'

// Dummy data for demonstration; replace with real DB/service integration
const conversations = [
    {
        conversationId: '1',
        status: 'active',
        participants: ['user1', 'bot'],
        lastMessage: 'Olá, como posso ajudar?',
        updatedAt: toISODateString(new Date()),
    },
    {
        conversationId: '2',
        status: 'pending',
        participants: ['user2', 'bot'],
        lastMessage: 'Preciso de um especialista.',
        updatedAt: toISODateString(new Date()),
    },
]

export default function handler(req: NextApiRequest, res: NextApiResponse) {
    if (req.method === 'GET') {
        res.status(200).json(conversations)
    } else {
        res.status(405).json({ error: 'Method not allowed' })
    }
}

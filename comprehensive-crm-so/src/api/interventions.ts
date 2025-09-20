import { NextApiRequest, NextApiResponse } from 'next'

export default function handler(req: NextApiRequest, res: NextApiResponse) {
    if (req.method === 'POST') {
        const { conversationId, interventionType, details } = req.body
        // TODO: Integrate with real business logic/service
        res.status(200).json({ success: true, conversationId, interventionType, details })
    } else {
        res.status(405).json({ error: 'Method not allowed' })
    }
}

import { NextApiRequest, NextApiResponse } from 'next'

export default function handler(req: NextApiRequest, res: NextApiResponse) {
    if (req.method === 'POST') {
        const { action, conversationId, payload } = req.body
        // TODO: Integrate with real business logic/service
        res.status(200).json({ success: true, action, conversationId, payload })
    } else {
        res.status(405).json({ error: 'Method not allowed' })
    }
}

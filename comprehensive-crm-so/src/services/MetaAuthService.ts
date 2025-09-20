interface MetaAuthConfig {
  appId: string
  appSecret: string
  redirectUri: string
  scopes: string[]
}

interface MetaTokenResponse {
  access_token: string
  token_type: string
  expires_in: number
  refresh_token?: string
}

interface MetaUserProfile {
  id: string
  name: string
  email?: string
  picture?: {
    data: {
      url: string
    }
  }
}

interface MetaPageInfo {
  id: string
  name: string
  access_token: string
  category: string
  category_list: Array<{
    id: string
    name: string
  }>
  tasks: string[]
}

interface InstagramAccount {
  id: string
  username: string
  profile_picture_url: string
  followers_count: number
  follows_count: number
  media_count: number
}

interface WhatsAppBusinessAccount {
  id: string
  name: string
  verification_status: string
  phone_number_id: string
  display_phone_number: string
}

export class MetaAuthService {
  private static instance: MetaAuthService
  private config: MetaAuthConfig

  constructor() {
    this.config = {
      appId: (import.meta as any).env?.VITE_META_APP_ID || 'mock_app_id',
      appSecret: (import.meta as any).env?.VITE_META_APP_SECRET || 'mock_app_secret',
      redirectUri: `${window.location.origin}/auth/meta/callback`,
      scopes: [
        'public_profile',
        'email',
        'pages_read_engagement',
        'pages_manage_posts',
        'pages_messaging',
        'instagram_basic',
        'instagram_content_publish',
        'whatsapp_business_messaging',
        'whatsapp_business_management'
      ]
    }
  }

  static getInstance(): MetaAuthService {
    if (!MetaAuthService.instance) {
      MetaAuthService.instance = new MetaAuthService()
    }
    return MetaAuthService.instance
  }

  // Generate OAuth URL for Meta Login
  generateAuthUrl(platform: 'facebook' | 'instagram' | 'whatsapp'): string {
    const baseUrl = 'https://www.facebook.com/v18.0/dialog/oauth'
    const params = new URLSearchParams({
      client_id: this.config.appId,
      redirect_uri: this.config.redirectUri,
      scope: this.config.scopes.join(','),
      response_type: 'code',
      state: `platform=${platform}&timestamp=${Date.now()}`
    })

    return `${baseUrl}?${params.toString()}`
  }

  // Exchange authorization code for access token
  async exchangeCodeForToken(code: string): Promise<MetaTokenResponse> {
    // In a real implementation, this would be done on the backend
    // Here we'll simulate the response
    await new Promise(resolve => setTimeout(resolve, 1000))

    return {
      access_token: `mock_access_token_${Date.now()}`,
      token_type: 'bearer',
      expires_in: 3600,
      refresh_token: `mock_refresh_token_${Date.now()}`
    }
  }

  // Get user profile information
  async getUserProfile(accessToken: string): Promise<MetaUserProfile> {
    // Mock API call
    await new Promise(resolve => setTimeout(resolve, 500))

    return {
      id: `user_${Date.now()}`,
      name: 'Empresa CRM',
      email: 'admin@empresacrm.com',
      picture: {
        data: {
          url: '/api/placeholder/100/100'
        }
      }
    }
  }

  // Get Facebook Pages managed by user
  async getUserPages(accessToken: string): Promise<MetaPageInfo[]> {
    await new Promise(resolve => setTimeout(resolve, 500))

    return [
      {
        id: `page_${Date.now()}`,
        name: 'Empresa CRM',
        access_token: `page_token_${Date.now()}`,
        category: 'Software Company',
        category_list: [
          { id: '1', name: 'Software Company' },
          { id: '2', name: 'Technology Company' }
        ],
        tasks: ['MANAGE', 'CREATE_CONTENT', 'MESSAGING']
      }
    ]
  }

  // Get Instagram Business Accounts connected to Facebook Pages
  async getInstagramAccounts(pageAccessToken: string): Promise<InstagramAccount[]> {
    await new Promise(resolve => setTimeout(resolve, 500))

    return [
      {
        id: `ig_${Date.now()}`,
        username: 'empresacrm',
        profile_picture_url: '/api/placeholder/100/100',
        followers_count: 8920,
        follows_count: 245,
        media_count: 127
      }
    ]
  }

  // Get WhatsApp Business Accounts
  async getWhatsAppBusinessAccounts(accessToken: string): Promise<WhatsAppBusinessAccount[]> {
    await new Promise(resolve => setTimeout(resolve, 500))

    return [
      {
        id: `whatsapp_${Date.now()}`,
        name: 'Empresa CRM Business',
        verification_status: 'VERIFIED',
        phone_number_id: 'phone_123456789',
        display_phone_number: '+55 11 99999-9999'
      }
    ]
  }

  // Send WhatsApp message
  async sendWhatsAppMessage(
    phoneNumberId: string,
    to: string,
    message: {
      type: 'text' | 'image' | 'document' | 'template'
      text?: { body: string }
      image?: { link: string, caption?: string }
      template?: { name: string, language: { code: string }, components?: any[] }
    },
    accessToken: string
  ): Promise<{ success: boolean, messageId?: string }> {
    // Mock sending message
    await new Promise(resolve => setTimeout(resolve, 500))

    return {
      success: true,
      messageId: `msg_${Date.now()}`
    }
  }

  // Send Instagram Direct Message
  async sendInstagramMessage(
    recipientId: string,
    message: {
      text?: string
      attachment?: {
        type: 'image' | 'video' | 'file'
        payload: { url: string }
      }
    },
    pageAccessToken: string
  ): Promise<{ success: boolean, messageId?: string }> {
    await new Promise(resolve => setTimeout(resolve, 500))

    return {
      success: true,
      messageId: `ig_msg_${Date.now()}`
    }
  }

  // Post to Facebook Page
  async postToFacebook(
    pageId: string,
    content: {
      message?: string
      link?: string
      photo?: string
      video?: string
      scheduled_publish_time?: number
    },
    pageAccessToken: string
  ): Promise<{ success: boolean, postId?: string }> {
    await new Promise(resolve => setTimeout(resolve, 500))

    return {
      success: true,
      postId: `fb_post_${Date.now()}`
    }
  }

  // Post to Instagram
  async postToInstagram(
    instagramAccountId: string,
    content: {
      image_url?: string
      video_url?: string
      caption?: string
      media_type: 'IMAGE' | 'VIDEO' | 'CAROUSEL_ALBUM'
      children?: string[] // For carousel
    },
    accessToken: string
  ): Promise<{ success: boolean, mediaId?: string }> {
    await new Promise(resolve => setTimeout(resolve, 1000))

    return {
      success: true,
      mediaId: `ig_media_${Date.now()}`
    }
  }

  // Get Facebook Page Insights
  async getPageInsights(
    pageId: string,
    metrics: string[],
    period: 'day' | 'week' | 'days_28',
    pageAccessToken: string
  ): Promise<any> {
    await new Promise(resolve => setTimeout(resolve, 500))

    return {
      data: metrics.map(metric => ({
        name: metric,
        period,
        values: [
          {
            value: Math.floor(Math.random() * 10000),
            end_time: new Date().toISOString()
          }
        ]
      }))
    }
  }

  // Get Instagram Insights
  async getInstagramInsights(
    mediaId: string,
    metrics: string[],
    accessToken: string
  ): Promise<any> {
    await new Promise(resolve => setTimeout(resolve, 500))

    return {
      data: metrics.map(metric => ({
        name: metric,
        period: 'lifetime',
        values: [
          {
            value: Math.floor(Math.random() * 1000)
          }
        ]
      }))
    }
  }

  // Subscribe to Webhooks
  async subscribeToWebhooks(
    objectType: 'page' | 'instagram' | 'whatsapp_business_account',
    objectId: string,
    fields: string[],
    accessToken: string
  ): Promise<{ success: boolean }> {
    await new Promise(resolve => setTimeout(resolve, 500))

    return { success: true }
  }

  // Validate webhook signature
  validateWebhookSignature(
    payload: string,
    signature: string,
    appSecret: string
  ): boolean {
    // In a real implementation, use crypto to validate
    // For mock purposes, always return true
    return true
  }

  // Handle webhook events
  handleWebhookEvent(event: any): void {
    switch (event.object) {
      case 'page':
        this.handleFacebookPageEvent(event)
        break
      case 'instagram':
        this.handleInstagramEvent(event)
        break
      case 'whatsapp_business_account':
        this.handleWhatsAppEvent(event)
        break
      default:
        console.log('Unknown webhook event:', event)
    }
  }

  private handleFacebookPageEvent(event: any): void {
    if (event.entry) {
      event.entry.forEach((entry: any) => {
        if (entry.messaging) {
          entry.messaging.forEach((messaging: any) => {
            // Handle Facebook Messenger events
            console.log('Facebook message event:', messaging)
          })
        }

        if (entry.changes) {
          entry.changes.forEach((change: any) => {
            // Handle page changes (posts, comments, etc.)
            console.log('Facebook page change:', change)
          })
        }
      })
    }
  }

  private handleInstagramEvent(event: any): void {
    if (event.entry) {
      event.entry.forEach((entry: any) => {
        if (entry.messaging) {
          entry.messaging.forEach((messaging: any) => {
            // Handle Instagram Direct Messages
            console.log('Instagram message event:', messaging)
          })
        }

        if (entry.changes) {
          entry.changes.forEach((change: any) => {
            // Handle Instagram changes (comments, mentions, etc.)
            console.log('Instagram change:', change)
          })
        }
      })
    }
  }

  private handleWhatsAppEvent(event: any): void {
    if (event.entry) {
      event.entry.forEach((entry: any) => {
        if (entry.changes) {
          entry.changes.forEach((change: any) => {
            if (change.value.messages) {
              change.value.messages.forEach((message: any) => {
                // Handle incoming WhatsApp messages
                console.log('WhatsApp message:', message)
              })
            }

            if (change.value.statuses) {
              change.value.statuses.forEach((status: any) => {
                // Handle message delivery statuses
                console.log('WhatsApp status:', status)
              })
            }
          })
        }
      })
    }
  }

  // Refresh access token
  async refreshAccessToken(refreshToken: string): Promise<MetaTokenResponse> {
    await new Promise(resolve => setTimeout(resolve, 500))

    return {
      access_token: `refreshed_token_${Date.now()}`,
      token_type: 'bearer',
      expires_in: 3600
    }
  }

  // Revoke access token
  async revokeAccessToken(accessToken: string): Promise<{ success: boolean }> {
    await new Promise(resolve => setTimeout(resolve, 500))

    return { success: true }
  }
}

export default MetaAuthService

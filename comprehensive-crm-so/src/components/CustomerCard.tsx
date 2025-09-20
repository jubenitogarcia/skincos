import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { formatCurrency, getRelativeTime, getInitials, getStatusColor } from "@/lib/utils"
import { Phone, Envelope, WhatsappLogo, ChatCircle, Calendar } from "@phosphor-icons/react"
import type { Customer } from "@/lib/types"

interface CustomerCardProps {
  customer: Customer
  onClick?: () => void
}

export function CustomerCard({ customer, onClick }: CustomerCardProps) {
  return (
    <Card className="glass-card hover:shadow-lg transition-all duration-300 cursor-pointer" onClick={onClick}>
      <CardHeader className="pb-3">
        <div className="flex items-center space-x-3">
          <Avatar className="h-12 w-12">
            <AvatarImage src={customer.avatar} alt={customer.name} />
            <AvatarFallback className="bg-primary text-primary-foreground">
              {getInitials(customer.name)}
            </AvatarFallback>
          </Avatar>
          <div className="flex-1 min-w-0">
            <CardTitle className="text-lg truncate">{customer.name}</CardTitle>
            <CardDescription className="truncate">{customer.company}</CardDescription>
          </div>
          <Badge className={getStatusColor(customer.status)} variant="secondary">
            {customer.status}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-center justify-between text-sm">
          <span className="text-muted-foreground">Score IA</span>
          <div className="flex items-center space-x-2">
            <div className={`h-2 w-16 rounded-full bg-gray-200`}>
              <div 
                className={`h-2 rounded-full transition-all duration-500 ${
                  customer.score >= 80 ? 'bg-green-500' : 
                  customer.score >= 60 ? 'bg-yellow-500' : 'bg-red-500'
                }`}
                style={{ width: `${customer.score}%` }}
              />
            </div>
            <span className="font-medium">{customer.score}</span>
          </div>
        </div>
        
        <div className="flex items-center justify-between text-sm">
          <span className="text-muted-foreground">Valor Total</span>
          <span className="font-semibold">{formatCurrency(customer.totalValue)}</span>
        </div>
        
        <div className="flex items-center justify-between text-sm">
          <span className="text-muted-foreground">Último Contato</span>
          <span>{getRelativeTime(customer.lastContact)}</span>
        </div>
        
        <div className="flex items-center space-x-1 pt-2">
          <Button size="sm" variant="outline" className="flex-1">
            <Phone className="h-4 w-4 mr-1" />
            Ligar
          </Button>
          <Button size="sm" variant="outline" className="flex-1">
            <Envelope className="h-4 w-4 mr-1" />
            Email
          </Button>
          <Button size="sm" variant="outline" className="flex-1">
            <WhatsappLogo className="h-4 w-4 mr-1" />
            WhatsApp
          </Button>
        </div>
        
        {customer.tags.length > 0 && (
          <div className="flex flex-wrap gap-1 pt-2">
            {customer.tags.slice(0, 3).map((tag) => (
              <Badge key={tag} variant="outline" className="text-xs">
                {tag}
              </Badge>
            ))}
            {customer.tags.length > 3 && (
              <Badge variant="outline" className="text-xs">
                +{customer.tags.length - 3}
              </Badge>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  )
}
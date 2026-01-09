import React, { useState } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/card'
import { Button } from '@/button'
import { Input } from '@/input'
import { Label } from '@/label'
import { Badge } from '@/badge'
import { ScrollArea } from '@/scroll-area'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/dialog'
import { Textarea } from '@/textarea'
import { 
  Plus, 
  Heart, 
  Play, 
  Trash, 
  PencilSimple,
  VideoCamera 
} from '@phosphor-icons/react'

interface CameraFavorite {
  id: string
  name: string
  automationScript?: string
  createdAt: string
}

interface CameraFavoritesProps {
  favorites: CameraFavorite[]
  onFavoritesChange: (favorites: CameraFavorite[]) => void
  onFavoriteClick: (favorite: CameraFavorite) => void
  onLog: (level: 'INFO' | 'WARNING' | 'ERROR' | 'STATUS', message: string) => void
}

export function CameraFavorites({ 
  favorites, 
  onFavoritesChange, 
  onFavoriteClick, 
  onLog 
}: CameraFavoritesProps) {
  const [showAddDialog, setShowAddDialog] = useState(false)
  const [editingFavorite, setEditingFavorite] = useState<CameraFavorite | null>(null)
  const [newFavorite, setNewFavorite] = useState({
    name: '',
    automationScript: ''
  })

  const handleAddFavorite = () => {
    if (!newFavorite.name.trim()) {
      onLog('WARNING', 'Favorite name is required')
      return
    }

    const favorite: CameraFavorite = {
      id: Date.now().toString(),
      name: newFavorite.name.trim(),
      automationScript: newFavorite.automationScript.trim() || undefined,
      createdAt: new Date().toISOString()
    }

    onFavoritesChange([...favorites, favorite])
    onLog('INFO', `Added camera favorite: ${favorite.name}`)
    
    setNewFavorite({ name: '', automationScript: '' })
    setShowAddDialog(false)
  }

  const handleEditFavorite = (favorite: CameraFavorite) => {
    setEditingFavorite(favorite)
    setNewFavorite({
      name: favorite.name,
      automationScript: favorite.automationScript || ''
    })
  }

  const handleUpdateFavorite = () => {
    if (!editingFavorite || !newFavorite.name.trim()) {
      onLog('WARNING', 'Favorite name is required')
      return
    }

    const updatedFavorites = favorites.map(fav => 
      fav.id === editingFavorite.id
        ? {
            ...fav,
            name: newFavorite.name.trim(),
            automationScript: newFavorite.automationScript.trim() || undefined
          }
        : fav
    )

    onFavoritesChange(updatedFavorites)
    onLog('INFO', `Updated camera favorite: ${newFavorite.name}`)
    
    setEditingFavorite(null)
    setNewFavorite({ name: '', automationScript: '' })
  }

  const handleDeleteFavorite = (favorite: CameraFavorite) => {
    onFavoritesChange(favorites.filter(fav => fav.id !== favorite.id))
    onLog('INFO', `Deleted camera favorite: ${favorite.name}`)
  }

  const resetDialog = () => {
    setNewFavorite({ name: '', automationScript: '' })
    setEditingFavorite(null)
    setShowAddDialog(false)
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-medium">Camera Favorites</h3>
        <Dialog open={showAddDialog || !!editingFavorite} onOpenChange={(open) => !open && resetDialog()}>
          <DialogTrigger asChild>
            <Button size="sm" onClick={() => setShowAddDialog(true)}>
              <Plus className="w-3 h-3 mr-1" />
              Add
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>
                {editingFavorite ? 'Edit Camera Favorite' : 'Add Camera Favorite'}
              </DialogTitle>
            </DialogHeader>
            <div className="space-y-4">
              <div>
                <Label htmlFor="favorite-name">Camera Name</Label>
                <Input
                  id="favorite-name"
                  value={newFavorite.name}
                  onChange={(e) => setNewFavorite(prev => ({ ...prev, name: e.target.value }))}
                  placeholder="e.g., Living Room Camera"
                  className="mt-1"
                />
              </div>
              
              <div>
                <Label htmlFor="automation-script">Automation Script (Optional)</Label>
                <Textarea
                  id="automation-script"
                  value={newFavorite.automationScript}
                  onChange={(e) => setNewFavorite(prev => ({ ...prev, automationScript: e.target.value }))}
                  placeholder="JavaScript code to automate camera access..."
                  className="mt-1 h-32 font-mono text-sm"
                />
                <p className="text-xs text-muted-foreground mt-1">
                  Example: document.querySelector('.camera-tile[data-name="Living Room"]').click()
                </p>
              </div>

              <div className="flex justify-end gap-2">
                <Button variant="outline" onClick={resetDialog}>
                  Cancel
                </Button>
                <Button onClick={editingFavorite ? handleUpdateFavorite : handleAddFavorite}>
                  {editingFavorite ? 'Update' : 'Add'}
                </Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      <ScrollArea className="h-48">
        <div className="space-y-2">
          {favorites.map((favorite) => (
            <Card key={favorite.id} className="p-3">
              <div className="flex items-start justify-between">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-2">
                    <VideoCamera className="w-4 h-4 text-primary flex-shrink-0" />
                    <h4 className="text-sm font-medium truncate">{favorite.name}</h4>
                  </div>
                  
                  {favorite.automationScript && (
                    <Badge variant="outline" className="text-xs mb-2">
                      Automated
                    </Badge>
                  )}
                  
                  <p className="text-xs text-muted-foreground">
                    Added {new Date(favorite.createdAt).toLocaleDateString()}
                  </p>
                </div>

                <div className="flex items-center gap-1 ml-2">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => onFavoriteClick(favorite)}
                    className="h-7 w-7 p-0"
                  >
                    <Play className="w-3 h-3" />
                  </Button>
                  
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => handleEditFavorite(favorite)}
                    className="h-7 w-7 p-0"
                  >
                    <PencilSimple className="w-3 h-3" />
                  </Button>
                  
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => handleDeleteFavorite(favorite)}
                    className="h-7 w-7 p-0 text-red-600 hover:text-red-700"
                  >
                    <Trash className="w-3 h-3" />
                  </Button>
                </div>
              </div>
            </Card>
          ))}

          {favorites.length === 0 && (
            <div className="text-center py-8 text-muted-foreground">
              <Heart className="w-6 h-6 mx-auto mb-2 opacity-50" />
              <p className="text-sm">No favorites yet</p>
              <p className="text-xs">Add frequently used cameras</p>
            </div>
          )}
        </div>
      </ScrollArea>
    </div>
  )
}
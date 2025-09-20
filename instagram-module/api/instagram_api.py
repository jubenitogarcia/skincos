#!/usr/bin/env python3
"""
Instagram API Routes for SKINCOS AI System
FastAPI-based REST API for Instagram Module integration
"""

from fastapi import FastAPI, HTTPException, Depends, BackgroundTasks, File, UploadFile
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from fastapi.responses import JSONResponse, FileResponse
from pydantic import BaseModel, Field
from typing import List, Dict, Optional, Any
import os
import json
import asyncio
from datetime import datetime
from pathlib import Path

# Import Instagram module
import sys
sys.path.append(os.path.dirname(os.path.dirname(__file__)))
from instagram_main import InstagramModule, OSINTResult

# FastAPI app
app = FastAPI(
    title="SKINCOS AI - Instagram API",
    description="Comprehensive Instagram automation and OSINT API",
    version="1.0.0"
)

# Security
security = HTTPBearer()

# Global Instagram module instance
instagram_module = InstagramModule()

# Pydantic models
class AccountAdd(BaseModel):
    username: str = Field(..., description="Instagram username")
    password: str = Field(..., description="Instagram password")
    account_id: Optional[str] = Field(None, description="Custom account identifier")

class OSINTRequest(BaseModel):
    username: str = Field(..., description="Target Instagram username")
    deep_analysis: bool = Field(True, description="Enable deep OSINT analysis")

class DownloadRequest(BaseModel):
    username: str = Field(..., description="Target Instagram username")
    content_types: List[str] = Field(['posts'], description="Content types: posts, stories, highlights")
    max_items: int = Field(50, description="Maximum items to download")

class AutomationRequest(BaseModel):
    account_id: str = Field(..., description="Account ID for automation")
    target_hashtags: List[str] = Field(['photography'], description="Target hashtags")
    max_likes: int = Field(10, description="Maximum likes to perform")
    max_follows: int = Field(5, description="Maximum follows to perform")

class PostUpload(BaseModel):
    account_id: str = Field(..., description="Account ID for posting")
    caption: str = Field(..., description="Post caption")
    hashtags: List[str] = Field([], description="Post hashtags")

# Authentication middleware
async def verify_token(credentials: HTTPAuthorizationCredentials = Depends(security)):
    """Verify JWT token for API access"""
    token = credentials.credentials
    # TODO: Implement JWT verification with SKINCOS AI auth system
    # For now, accept any token (development mode)
    if not token:
        raise HTTPException(status_code=401, detail="Invalid authentication credentials")
    return token

# Health check
@app.get("/health", tags=["System"])
async def health_check():
    """Check Instagram module health"""
    try:
        health = instagram_module.health_check()
        return JSONResponse(content=health)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

# Account management
@app.post("/accounts", tags=["Accounts"])
async def add_account(account: AccountAdd, token: str = Depends(verify_token)):
    """Add Instagram account to the module"""
    try:
        account_id = instagram_module.add_account(
            username=account.username,
            password=account.password,
            account_id=account.account_id
        )
        
        return JSONResponse(content={
            "success": True,
            "message": "Account added successfully",
            "account_id": account_id
        })
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))

@app.get("/accounts", tags=["Accounts"])
async def list_accounts(token: str = Depends(verify_token)):
    """List configured Instagram accounts"""
    try:
        accounts = []
        for account_config in instagram_module.config.get("accounts", []):
            accounts.append({
                "account_id": account_config["account_id"],
                "username": account_config["username"],
                "added_at": account_config["added_at"],
                "is_active": account_config["account_id"] in instagram_module.clients
            })
        
        return JSONResponse(content={
            "success": True,
            "accounts": accounts,
            "total": len(accounts)
        })
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/accounts/{account_id}/analytics", tags=["Accounts"])
async def get_account_analytics(account_id: str, token: str = Depends(verify_token)):
    """Get account analytics and insights"""
    try:
        analytics = instagram_module.get_analytics(account_id)
        return JSONResponse(content={
            "success": True,
            "analytics": analytics
        })
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))

# OSINT endpoints
@app.post("/osint/investigate", tags=["OSINT"])
async def osint_investigate(request: OSINTRequest, background_tasks: BackgroundTasks, token: str = Depends(verify_token)):
    """Perform OSINT investigation on Instagram profile"""
    try:
        # Run investigation in background for large analyses
        if request.deep_analysis:
            background_tasks.add_task(
                run_background_osint,
                request.username,
                request.deep_analysis
            )
            
            return JSONResponse(content={
                "success": True,
                "message": "Deep OSINT investigation started in background",
                "username": request.username,
                "status": "processing"
            })
        else:
            # Quick investigation
            result = instagram_module.osint_investigate(
                target_username=request.username,
                deep_analysis=False
            )
            
            return JSONResponse(content={
                "success": True,
                "result": result.__dict__
            })
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))

async def run_background_osint(username: str, deep_analysis: bool):
    """Background task for deep OSINT analysis"""
    try:
        result = instagram_module.osint_investigate(username, deep_analysis)
        # Save result to background results folder
        results_dir = Path("instagram-module/background_results")
        results_dir.mkdir(exist_ok=True)
        
        result_file = results_dir / f"osint_{username}_{datetime.now().strftime('%Y%m%d_%H%M%S')}.json"
        with open(result_file, 'w') as f:
            json.dump(result.__dict__, f, indent=2)
            
    except Exception as e:
        # Log error
        import logging
        logging.error(f"Background OSINT failed for {username}: {e}")

@app.get("/osint/results/{username}", tags=["OSINT"])
async def get_osint_results(username: str, token: str = Depends(verify_token)):
    """Get OSINT investigation results"""
    try:
        results_dir = Path("instagram-module/background_results")
        results_files = list(results_dir.glob(f"osint_{username}_*.json"))
        
        if not results_files:
            raise HTTPException(status_code=404, detail="No results found for this username")
        
        # Get most recent result
        latest_file = max(results_files, key=lambda f: f.stat().st_mtime)
        
        with open(latest_file, 'r') as f:
            result = json.load(f)
        
        return JSONResponse(content={
            "success": True,
            "result": result,
            "generated_at": latest_file.stem.split('_')[-2:]
        })
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

# Content download endpoints
@app.post("/download/content", tags=["Content"])
async def download_content(request: DownloadRequest, background_tasks: BackgroundTasks, token: str = Depends(verify_token)):
    """Download Instagram content"""
    try:
        # Run download in background
        background_tasks.add_task(
            run_background_download,
            request.username,
            request.content_types,
            request.max_items
        )
        
        return JSONResponse(content={
            "success": True,
            "message": "Content download started in background",
            "username": request.username,
            "content_types": request.content_types,
            "status": "processing"
        })
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))

async def run_background_download(username: str, content_types: List[str], max_items: int):
    """Background task for content download"""
    try:
        downloaded_files = instagram_module.download_content(
            target_username=username,
            content_types=content_types,
            max_items=max_items
        )
        
        # Save download summary
        downloads_dir = Path("instagram-module/downloads")
        summary_file = downloads_dir / f"download_summary_{username}_{datetime.now().strftime('%Y%m%d_%H%M%S')}.json"
        
        with open(summary_file, 'w') as f:
            json.dump({
                "username": username,
                "content_types": content_types,
                "max_items": max_items,
                "downloaded_files": downloaded_files,
                "timestamp": datetime.now().isoformat()
            }, f, indent=2)
            
    except Exception as e:
        import logging
        logging.error(f"Background download failed for {username}: {e}")

@app.get("/download/status/{username}", tags=["Content"])
async def get_download_status(username: str, token: str = Depends(verify_token)):
    """Get download status and results"""
    try:
        downloads_dir = Path("instagram-module/downloads")
        summary_files = list(downloads_dir.glob(f"download_summary_{username}_*.json"))
        
        if not summary_files:
            return JSONResponse(content={
                "success": True,
                "status": "not_found",
                "message": "No downloads found for this username"
            })
        
        # Get most recent download
        latest_file = max(summary_files, key=lambda f: f.stat().st_mtime)
        
        with open(latest_file, 'r') as f:
            summary = json.load(f)
        
        return JSONResponse(content={
            "success": True,
            "status": "completed",
            "summary": summary
        })
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

# Automation endpoints
@app.post("/automation/engage", tags=["Automation"])
async def automate_engagement(request: AutomationRequest, background_tasks: BackgroundTasks, token: str = Depends(verify_token)):
    """Automated Instagram engagement"""
    try:
        # Run automation in background
        background_tasks.add_task(
            run_background_automation,
            request.account_id,
            request.target_hashtags,
            request.max_likes,
            request.max_follows
        )
        
        return JSONResponse(content={
            "success": True,
            "message": "Automation started in background",
            "account_id": request.account_id,
            "status": "processing"
        })
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))

async def run_background_automation(account_id: str, target_hashtags: List[str], max_likes: int, max_follows: int):
    """Background task for automation"""
    try:
        stats = instagram_module.automate_engagement(
            account_id=account_id,
            target_hashtags=target_hashtags,
            max_likes=max_likes,
            max_follows=max_follows
        )
        
        # Save automation results
        automation_dir = Path("instagram-module/automation_results")
        automation_dir.mkdir(exist_ok=True)
        
        result_file = automation_dir / f"automation_{account_id}_{datetime.now().strftime('%Y%m%d_%H%M%S')}.json"
        with open(result_file, 'w') as f:
            json.dump({
                "account_id": account_id,
                "target_hashtags": target_hashtags,
                "max_likes": max_likes,
                "max_follows": max_follows,
                "stats": stats,
                "timestamp": datetime.now().isoformat()
            }, f, indent=2)
            
    except Exception as e:
        import logging
        logging.error(f"Background automation failed for {account_id}: {e}")

@app.get("/automation/results/{account_id}", tags=["Automation"])
async def get_automation_results(account_id: str, token: str = Depends(verify_token)):
    """Get automation results"""
    try:
        automation_dir = Path("instagram-module/automation_results")
        result_files = list(automation_dir.glob(f"automation_{account_id}_*.json"))
        
        if not result_files:
            raise HTTPException(status_code=404, detail="No automation results found for this account")
        
        # Get most recent result
        latest_file = max(result_files, key=lambda f: f.stat().st_mtime)
        
        with open(latest_file, 'r') as f:
            result = json.load(f)
        
        return JSONResponse(content={
            "success": True,
            "result": result
        })
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

# Content upload endpoints
@app.post("/upload/post", tags=["Content"])
async def upload_post(
    post: PostUpload,
    image: UploadFile = File(...),
    token: str = Depends(verify_token)
):
    """Upload post to Instagram"""
    try:
        client = instagram_module.get_client(post.account_id)
        if not client:
            raise HTTPException(status_code=404, detail="Account not found")
        
        # Save uploaded file temporarily
        upload_dir = Path("instagram-module/uploads")
        upload_dir.mkdir(exist_ok=True)
        
        file_path = upload_dir / f"temp_{datetime.now().strftime('%Y%m%d_%H%M%S')}_{image.filename}"
        
        with open(file_path, "wb") as f:
            content = await image.read()
            f.write(content)
        
        # Prepare caption with hashtags
        full_caption = post.caption
        if post.hashtags:
            hashtags_str = " ".join(f"#{tag}" for tag in post.hashtags)
            full_caption += f"\n\n{hashtags_str}"
        
        # Upload to Instagram
        result = client.photo_upload(file_path, full_caption)
        
        # Clean up temporary file
        os.unlink(file_path)
        
        return JSONResponse(content={
            "success": True,
            "message": "Post uploaded successfully",
            "post_id": result.id,
            "shortcode": result.code
        })
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))

# Configuration endpoints
@app.get("/config", tags=["Configuration"])
async def get_config(token: str = Depends(verify_token)):
    """Get current module configuration"""
    try:
        # Return config without sensitive data
        safe_config = instagram_module.config.copy()
        if "accounts" in safe_config:
            for account in safe_config["accounts"]:
                account.pop("password", None)
        
        return JSONResponse(content={
            "success": True,
            "config": safe_config
        })
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.put("/config", tags=["Configuration"])
async def update_config(config: Dict[str, Any], token: str = Depends(verify_token)):
    """Update module configuration"""
    try:
        # Validate and update config
        instagram_module.config.update(config)
        instagram_module._save_config()
        
        return JSONResponse(content={
            "success": True,
            "message": "Configuration updated successfully"
        })
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=3003)
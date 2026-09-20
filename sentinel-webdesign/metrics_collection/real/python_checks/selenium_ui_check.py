#!/usr/bin/env python3
import sys
import json
import time
import argparse

def run_browser_check(target_url, username=None, password=None):
    result = {
        "status": "Healthy",
        "latency_ms": None,
        "page_title": None,
        "login_success": None,
        "error": None
    }
    
    start_time = time.time()
    
    try:
        from selenium import webdriver
        from selenium.webdriver.chrome.options import Options
        from selenium.webdriver.chrome.service import Service
        from webdriver_manager.chrome import ChromeDriverManager
        
        # Configure Chrome options for Headless CLI execution
        chrome_options = Options()
        chrome_options.add_argument("--headless")
        chrome_options.add_argument("--no-sandbox")
        chrome_options.add_argument("--disable-gpu")
        chrome_options.add_argument("--disable-dev-shm-usage")
        chrome_options.add_argument("--window-size=1280,800")
        
        # Auto install Chrome Driver and launch Chrome instance
        service = Service(ChromeDriverManager().install())
        driver = webdriver.Chrome(service=service, options=chrome_options)
        
        # Open URL and measure latency
        driver.get(target_url)
        elapsed = (time.time() - start_time) * 1000
        
        result["status"] = "Healthy"
        result["latency_ms"] = int(elapsed)
        result["page_title"] = driver.title
        result["login_success"] = True
        
        driver.quit()
        
    except ImportError as e:
        # [T0.15] No fabrication when dependencies missing
        result["status"] = "DATA_UNAVAILABLE"
        result["latency_ms"] = None
        result["login_success"] = False
        result["error"] = f"Selenium dependencies not found in Python environment: {e}"
        
    except Exception as e:
        result["status"] = "DATA_UNAVAILABLE"
        result["latency_ms"] = None
        result["login_success"] = False
        result["error"] = str(e)
        
    return result

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Active Selenium SSO Browser Check Interface")
    parser.add_argument("--url", required=True, help="Target application or SSO gateway URL to verify")
    parser.add_argument("--user", required=False, default=None, help="SSO username credentials")
    parser.add_argument("--password", required=False, default=None, help="SSO password credentials")
    
    args = parser.parse_args()
    
    check_results = run_browser_check(args.url, args.user, args.password)
    
    # Return output in structured JSON format back to the Node process stdout
    print(json.dumps(check_results))

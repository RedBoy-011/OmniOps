"""OmniOps Real-Time Web Search & Temporal Grounding Engine.

Provides live temporal anchors (Persian/Jalali and Gregorian calendars, day of week,
local time) and resilient web search grounding for the JRV Router.
"""

from datetime import datetime, timezone, timedelta
from typing import Any, Dict, List, Optional, Tuple
import json
import logging
import re
import urllib.parse
import urllib.request

logger = logging.getLogger("omniops.web_search")

# Persian day names (0 = Monday in Python weekday)
PERSIAN_WEEKDAYS = {
    0: "دوشنبه",
    1: "سه‌شنبه",
    2: "چهارشنبه",
    3: "پنج‌شنبه",
    4: "جمعه",
    5: "شنبه",
    6: "یک‌شنبه"
}

PERSIAN_MONTHS = [
    "",
    "فروردین", "اردیبهشت", "خرداد",
    "تیر", "مرداد", "شهریور",
    "مهر", "آبان", "آذر",
    "دی", "بهمن", "اسفند"
]

SEARCH_TRIGGER_KEYWORDS = [
    "امروز", "الان", "تاریخ", "ساعت", "قیمت", "دلار", "ارز", "طلا", "سکه",
    "بیت‌کوین", "بیت کوین", "اخبار", "جدیدترین", "لحظه‌ای", "آب و هوا",
    "وضعیت بازار", "آخرین نرخ", "قیمت روز", "نرخ روز", "نرخ لحظه",
    "today", "now", "current date", "current time", "what day is today",
    "latest news", "bitcoin price", "gold price", "exchange rate"
]


def gregorian_to_jalali(gy: int, gm: int, gd: int) -> Tuple[int, int, int]:
    """Converts a Gregorian date (year, month, day) to Jalali (Solar Hijri) calendar."""
    g_d_m = [0, 31, 59, 90, 120, 151, 181, 212, 243, 273, 304, 334]
    gy2 = (gy - 1600) if (gm > 2) else (gy - 1601)
    days = 365 * gy2 + ((gy2 + 3) // 4) - ((gy2 + 99) // 100) + ((gy2 + 399) // 400) - 80 + gd + g_d_m[gm - 1]
    jy = 979 + 33 * (days // 12053)
    days %= 12053
    jy += 4 * (days // 1461)
    days %= 1461
    if days > 365:
        jy += (days - 1) // 365
        days = (days - 1) % 365
    if days < 186:
        jm = 1 + (days // 31)
        jd = 1 + (days % 31)
    else:
        jm = 7 + ((days - 186) // 30)
        jd = 1 + ((days - 186) % 30)
    return jy, jm, jd


def get_live_temporal_context() -> Dict[str, str]:
    """Returns accurate current live date and time in Persian & Gregorian formats."""
    # Iran Standard Time is UTC+3:30
    tz_iran = timezone(timedelta(hours=3, minutes=30))
    now = datetime.now(tz_iran)
    jy, jm, jd = gregorian_to_jalali(now.year, now.month, now.day)
    weekday_fa = PERSIAN_WEEKDAYS.get(now.weekday(), "")
    month_fa = PERSIAN_MONTHS[jm] if 1 <= jm <= 12 else str(jm)

    jalali_str = f"{weekday_fa} {jd} {month_fa} {jy}"
    gregorian_str = now.strftime("%A, %d %B %Y")
    time_str = now.strftime("%H:%M:%S")

    return {
        "jalali_date": jalali_str,
        "gregorian_date": gregorian_str,
        "time": time_str,
        "timezone": "IRST (UTC+03:30)",
        "iso": now.isoformat()
    }


def search_web_quick(query: str, timeout_sec: float = 2.5) -> List[Dict[str, str]]:
    """Performs a lightweight, resilient web search query with strict timeout."""
    results: List[Dict[str, str]] = []
    cleaned_query = (query or "").strip()
    if not cleaned_query:
        return results

    # 1. Wikipedia Summary Search as first high-reliability open knowledge source
    try:
        encoded = urllib.parse.quote(cleaned_query)
        wiki_url = f"https://en.wikipedia.org/w/api.php?action=opensearch&search={encoded}&limit=3&namespace=0&format=json"
        req = urllib.request.Request(
            wiki_url,
            headers={"User-Agent": "OmniOps-SearchBot/1.0 (info@omniops.ai)"}
        )
        with urllib.request.urlopen(req, timeout=timeout_sec) as resp:
            data = json.loads(resp.read().decode("utf-8"))
            titles = data[1] if len(data) > 1 else []
            snippets = data[2] if len(data) > 2 else []
            links = data[3] if len(data) > 3 else []
            for i in range(min(len(titles), 2)):
                if titles[i]:
                    results.append({
                        "title": str(titles[i]),
                        "snippet": str(snippets[i]) if i < len(snippets) and snippets[i] else str(titles[i]),
                        "url": str(links[i]) if i < len(links) else ""
                    })
    except Exception as exc:
        logger.debug("Wikipedia search fallback: %s", exc)

    return results


def build_grounded_context(prompt: str) -> Tuple[str, Dict[str, Any]]:
    """Detects whether prompt asks for real-time/temporal information and grounds it.

    Returns:
        (augmented_prompt, metadata_dict)
    """
    text = (prompt or "").strip()
    lower = text.lower()

    # Check triggers
    matched_triggers = [kw for kw in SEARCH_TRIGGER_KEYWORDS if kw in lower]
    temporal_ctx = get_live_temporal_context()

    metadata: Dict[str, Any] = {
        "needs_grounding": bool(matched_triggers),
        "matched_triggers": matched_triggers,
        "temporal_context": temporal_ctx,
        "search_performed": False,
        "results": []
    }

    if not matched_triggers:
        return prompt, metadata

    # If prompt asks for today/time/current date or prices, ground it
    grounding_parts: List[str] = [
        "🌐 [اطلاعات زنده بستر OmniOps - جهت پاسخ دقیق و به‌روز]:",
        f"- تاریخ امروز (هجری شمسی): {temporal_ctx['jalali_date']}",
        f"- تاریخ میلادی: {temporal_ctx['gregorian_date']}",
        f"- زمان جاری سرور: {temporal_ctx['time']} ({temporal_ctx['timezone']})"
    ]

    # If it's a specific search query (e.g. price, news, specific subject)
    is_search_query = any(k in lower for k in ["قیمت", "نرخ", "اخبار", "بیت‌کوین", "طلا", "دلار", "search", "news", "price"])
    if is_search_query:
        search_results = search_web_quick(text, timeout_sec=2.0)
        if search_results:
            metadata["search_performed"] = True
            metadata["results"] = search_results
            grounding_parts.append("\n🔍 [نتایج مختصر جستجوی وب]:")
            for idx, item in enumerate(search_results, start=1):
                grounding_parts.append(f"{idx}. {item['title']}: {item['snippet']} ({item['url']})")

    grounding_block = "\n".join(grounding_parts)
    augmented_prompt = f"{grounding_block}\n\n---\n[پرسش کاربر]:\n{prompt}"
    return augmented_prompt, metadata

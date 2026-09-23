"""Conservative Coach domain gate for clear requests; no extra model call."""

from __future__ import annotations

import re
from typing import Literal

Domain = Literal["in_domain", "adjacent_but_relevant", "unrelated", "uncertain"]

DOMAIN_CUE = re.compile(
    r"\b(?:calisthenics|bodyweight|pull[ -]?ups?|chin[ -]?ups?|dips?|push[ -]?ups?|"
    r"muscle[ -]?ups?|front lever|back lever|false grip|handstands?|planche|rings?|"
    r"mobility|wrists?|progressions?|regressions?|reps?|sets?|workouts?|"
    r"strength|recovery|exercise|training|train|rest|sleep)\b",
    re.IGNORECASE,
)
UNRELATED_CUE = re.compile(
    r"\b(?:free[ -]?diving|bitcoin|cryptocurrency|quantum computing|"
    r"elections?|vot(?:e|ing)|python(?:\s+(?:code|script))?|"
    r"(?:write|make|create)\s+(?:me\s+)?(?:a\s+)?(?:python\s+)?(?:code|script)|"
    r"(?:teach|explain)\s+(?:me\s+)?react(?:\.js)?)\b",
    re.IGNORECASE,
)
CONTEXTUAL = re.compile(
    r"^\s*(?:what about|how about|and\b|what next|should i|can i|does that)",
    re.IGNORECASE,
)
CONVERSATIONAL = re.compile(
    r"^\s*(?:(?:hi|hello|hey)(?: there| coach)?|"
    r"good (?:morning|afternoon|evening)(?: coach)?|"
    r"how are you|how's it going|"
    r"thanks(?: for (?:that|explaining|your help))?(?:,? that helps)?|"
    r"thank you(?:,? that helps)?|got it|okay(?:,? thanks)?|ok(?:,? thanks)?|"
    r"that makes sense|(?:can|could) you explain (?:that|it) again|"
    r"make it shorter|(?:please )?continue|why(?: is that)?)\s*[.!?]*\s*$",
    re.IGNORECASE,
)
DOMAIN_REDIRECT = (
    "I'm focused on calisthenics and bodyweight training. I can help with "
    "technique, skills, programming, progressions, recovery, or your Open Ascent training data."
)
DOMAIN_CLARIFICATION = "Is this about how it relates to your calisthenics training?"


def classify_coach_request(content: str, prior_user_messages: list[str] | None = None) -> Domain:
    """Resolve clear cases locally and ask for context when the topic is ambiguous."""
    has_domain_cue = DOMAIN_CUE.search(content) is not None
    has_unrelated_cue = UNRELATED_CUE.search(content) is not None
    if has_domain_cue:
        return "adjacent_but_relevant" if has_unrelated_cue else "in_domain"
    if has_unrelated_cue:
        return "unrelated"
    if CONVERSATIONAL.fullmatch(content):
        return "in_domain"
    if CONTEXTUAL.search(content) and any(
        DOMAIN_CUE.search(previous) for previous in prior_user_messages or []
    ):
        return "adjacent_but_relevant"
    return "uncertain"

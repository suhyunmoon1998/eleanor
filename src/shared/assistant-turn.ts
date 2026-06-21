function normalizeQuestionText(text: string) {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\b(to start|first|so|okay|ok|got it|thanks|thank you|let s|let us)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function isDuplicateQuestionCandidate(spokenReply: string, nextQuestion: string) {
  const spoken = normalizeQuestionText(spokenReply);
  const next = normalizeQuestionText(nextQuestion);
  if (!spoken || !next) return false;
  if (spoken === next) return true;
  if (spoken.includes(next) || next.includes(spoken)) return true;

  const spokenWords = new Set(spoken.split(" ").filter((word) => word.length > 3));
  const nextWords = next.split(" ").filter((word) => word.length > 3);
  if (spokenWords.size < 5 || nextWords.length < 5) return false;
  const overlap = nextWords.filter((word) => spokenWords.has(word)).length;
  return overlap / nextWords.length >= 0.72;
}

export function buildAssistantTurnText(spokenReply: string, nextQuestion: string) {
  const cleanReply = spokenReply.trim();
  const cleanQuestion = nextQuestion.trim();
  if (!cleanReply) return cleanQuestion;
  if (!cleanQuestion) return cleanReply;
  if (isDuplicateQuestionCandidate(cleanReply, cleanQuestion)) {
    return cleanQuestion;
  }
  return [cleanReply, cleanQuestion].join("\n\n");
}

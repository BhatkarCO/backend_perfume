import axios from "axios";

const AI_SERVICE_URL = "https://chat-bot-1-v8we.onrender.com/chat";

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export const chatWithAI = async (req, res) => {
  const MAX_ATTEMPTS = 2;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      const response = await axios.post(
        AI_SERVICE_URL,
        { message: req.body.message },
        {
          timeout: 15000,
          maxBodyLength: 8 * 1024,
          maxContentLength: 256 * 1024,
          headers: {
            "Content-Type": "application/json",
          },
        }
      );

      return res.status(200).json(response.data);

    } catch (error) {
      const status = error.response?.status;
      console.warn("AI service request failed.", { attempt, status });

      const retryable =
        !status || [408, 429, 500, 502, 503, 504].includes(status);

      if (!retryable || attempt === MAX_ATTEMPTS) {
        break;
      }

      await sleep(1000);
    }
  }

  console.warn("AI service unavailable after retries.");

  return res.status(503).json({
    reply:
      "The fragrance assistant is waking up. Please try sending your message again in a few seconds.",
  });
};
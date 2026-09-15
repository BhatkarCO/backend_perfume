import axios from "axios";

const AI_SERVICE_URL = "https://chat-bot-1-v8we.onrender.com/chat";

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export const chatWithAI = async (req, res) => {
  const MAX_ATTEMPTS = 2;
  let lastError;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      console.log(`===== AI SERVICE ATTEMPT ${attempt} =====`);

      const response = await axios.post(
        AI_SERVICE_URL,
        req.body,
        {
          timeout: 45000, // wait up to 45 seconds
          headers: {
            "Content-Type": "application/json",
          },
        }
      );

      console.log("===== AI SERVICE RESPONSE =====");
      console.log(JSON.stringify(response.data, null, 2));

      return res.status(200).json(response.data);

    } catch (error) {
      lastError = error;

      console.error(`===== AI SERVICE ERROR - ATTEMPT ${attempt} =====`);
      console.error("Message:", error.message);

      if (error.response) {
        console.error("Status:", error.response.status);
        console.error("Response:", error.response.data);
      }

      const retryable =
        !error.response ||
        [408, 429, 500, 502, 503, 504].includes(error.response.status);

      if (!retryable || attempt === MAX_ATTEMPTS) {
        break;
      }

      console.log("AI service may be waking up. Retrying in 3 seconds...");
      await sleep(3000);
    }
  }

  console.error("===== AI SERVICE FAILED AFTER RETRIES =====");

  return res.status(503).json({
    reply:
      "The fragrance assistant is waking up. Please try sending your message again in a few seconds.",
    error: lastError?.message || "AI service unavailable",
  });
};
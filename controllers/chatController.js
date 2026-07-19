import axios from "axios";

export const chatWithAI = async (req, res) => {
  try {
    const response = await axios.post(
      "https://ai-service-perfume.onrender.com/chat",
      req.body,
    );

    res.status(200).json(response.data);
  } catch (error) {
    console.error("===== AI SERVICE ERROR =====");
    console.error("Message:", error.message);

    if (error.response) {
      console.error("Status:", error.response.status);
      console.error("Response:", error.response.data);
    } else if (error.request) {
      console.error("No response received from AI service");
    }

    res.status(500).json({
      reply: "Sorry, I couldn't connect to the AI service.",
      error: error.message,
    });
  }
};

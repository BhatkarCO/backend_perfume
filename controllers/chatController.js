import axios from "axios";

export const chatWithAI = async (req, res) => {
  try {
    const response = await axios.post(
      "https://ai-service-perfume.onrender.com/chat",
      req.body
    );

    res.status(200).json(response.data);
  } catch (error) {
    console.error("AI Service Error:", error.message);

    res.status(500).json({
      reply: "Sorry, I couldn't connect to the AI service.",
    });
  }
};
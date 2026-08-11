import os
import asyncio
from datasets import Dataset

# To run this script, you must install ragas:
# pip install ragas langchain langchain-openai langchain-google-genai

try:
    from ragas import evaluate
    from ragas.metrics import (
        faithfulness,
        answer_relevancy,
        context_precision,
        context_recall
    )
    # Import LLMs (You can use OpenAI or Gemini via Langchain for Evaluation)
    from langchain_google_genai import ChatGoogleGenerativeAI
    from langchain_google_genai import GoogleGenerativeAIEmbeddings
except ImportError:
    print("❌ Required libraries not found.")
    print("Please run: pip install ragas langchain langchain-openai langchain-google-genai")
    exit(1)

# Ensure you have your API keys set in .env or environment
GEMINI_API_KEY = os.getenv("GEMINI_API_KEY")

def run_evaluation():
    if not GEMINI_API_KEY:
        print("❌ GEMINI_API_KEY is missing. Please set it in your environment.")
        return

    print("🚀 Starting RAG Evaluation with RAGAS...")

    # 1. Define your test cases (Ground Truth)
    # Note: 'contexts' should be the actual chunks your ChromaDB retrieved for the question
    # 'answer' should be the actual answer your system generated
    data = {
        "question": [
            "What is the main topic of the uploaded document?",
            "How does the system handle chunking?"
        ],
        "answer": [
            "The main topic is RAG optimization.",
            "The system uses semantic chunking based on paragraphs and sentences."
        ],
        "contexts": [
            ["[Source: doc1.pdf - Page 1] This document focuses on RAG optimization techniques."],
            ["[Source: design.docx - Page 2] We implemented semantic chunking that splits by paragraphs and sentences to preserve meaning."]
        ],
        "ground_truth": [
            "RAG optimization.",
            "It splits text into chunks using paragraphs and sentences."
        ]
    }

    dataset = Dataset.from_dict(data)

    # 2. Setup Evaluation LLM and Embeddings
    # RAGAS uses an LLM to act as a "Judge" for faithfulness and relevance.
    eval_llm = ChatGoogleGenerativeAI(model="gemini-1.5-flash", google_api_key=GEMINI_API_KEY)
    eval_embeddings = GoogleGenerativeAIEmbeddings(model="models/embedding-001", google_api_key=GEMINI_API_KEY)

    # 3. Define metrics to evaluate
    metrics = [
        faithfulness,       # Is the answer derived ONLY from the context? (Hallucination check)
        answer_relevancy,   # Does the answer actually address the question?
        context_precision,  # Did we retrieve the right context chunks?
        context_recall      # Did the context contain all info needed for the ground truth?
    ]

    print("📊 Evaluating metrics (This may take a minute)...")
    
    # 4. Run Evaluation
    result = evaluate(
        dataset=dataset,
        metrics=metrics,
        llm=eval_llm,
        embeddings=eval_embeddings
    )

    print("\n✅ Evaluation Complete!")
    print("========================")
    print(result)
    
    # You can also export this to a Pandas DataFrame for detailed analysis
    # df = result.to_pandas()
    # df.to_csv("evaluation_results.csv", index=False)
    # print("Saved detailed results to evaluation_results.csv")

if __name__ == "__main__":
    run_evaluation()

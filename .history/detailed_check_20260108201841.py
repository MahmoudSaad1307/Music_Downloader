import sys
import re
import json

try:
    import PyPDF2
    PDF_LIB = "PyPDF2"
except ImportError:
    PDF_LIB = None

def extract_text_pypdf2(filepath):
    """Extract text using PyPDF2"""
    text = ""
    with open(filepath, 'rb') as file:
        reader = PyPDF2.PdfReader(file)
        for page in reader.pages:
            text += page.extract_text() + "\n"
    return text

def extract_pdf_text(filepath):
    """Extract text from PDF using available library"""
    if PDF_LIB == "PyPDF2":
        return extract_text_pypdf2(filepath)
    return None

def extract_questions_from_html(html_file):
    """Extract all questions and mnemonics from the HTML file"""
    with open(html_file, 'r', encoding='utf-8') as f:
        content = f.read()
    
    questions_data = {}
    sections = ['sdlc', 'planning', 'requirements', 'management', 'modeling', 'elicitation']
    
    for section in sections:
        questions_data[section] = []
        # Find the section
        section_pattern = rf'{section}:\s*\[(.*?)\]\s*,'
        match = re.search(section_pattern, content, re.DOTALL)
        if match:
            section_content = match.group(1)
            # Find all question objects in this section
            # Pattern to match: { mnemonic: "...", question: "...", title: "...", answer: [...] }
            obj_pattern = r'\{[^}]*?mnemonic:\s*"([^"]+)"[^}]*?question:\s*"([^"]+)"[^}]*?title:\s*"([^"]+)"[^}]*?\}'
            matches = re.finditer(obj_pattern, section_content, re.DOTALL)
            
            for match in matches:
                mnemonic = match.group(1)
                question = match.group(2)
                title = match.group(3)
                
                questions_data[section].append({
                    'mnemonic': mnemonic,
                    'question': question,
                    'title': title
                })
    
    return questions_data

def search_concept_in_text(concept, text):
    """Search for a concept/keyword in text"""
    # Extract key words from concept
    words = re.findall(r'\b\w+\b', concept.lower())
    # Check if at least 2 key words appear
    found_count = sum(1 for word in words if len(word) > 3 and word in text.lower())
    return found_count >= min(2, len(words))

def main():
    if PDF_LIB is None:
        print("ERROR: PyPDF2 not found")
        return
    
    print("=" * 70)
    print("DETAILED QUESTION VERIFICATION")
    print("=" * 70)
    
    # Extract questions from HTML
    html_questions = extract_questions_from_html("index.html")
    total_questions = sum(len(q) for q in html_questions.values())
    print(f"\nTotal questions in HTML: {total_questions}")
    for section, questions in html_questions.items():
        print(f"  {section}: {len(questions)} questions")
    
    # Extract text from all PDFs
    pdf_files = ["Lec 2.pdf", "Lec3.pdf", "Lec4.pdf", "Lec5.pdf"]
    all_pdf_text = ""
    pdf_texts = {}
    
    for pdf_file in pdf_files:
        try:
            text = extract_pdf_text(pdf_file)
            if text:
                all_pdf_text += text + "\n"
                pdf_texts[pdf_file] = text
                print(f"\nExtracted {len(text)} characters from {pdf_file}")
        except Exception as e:
            print(f"Error processing {pdf_file}: {e}")
    
    print(f"\nTotal PDF text length: {len(all_pdf_text)} characters")
    
    # Check each question
    print("\n" + "=" * 70)
    print("VERIFICATION RESULTS")
    print("=" * 70)
    
    missing_mnemonics = []
    missing_concepts = []
    found_count = 0
    
    for section, questions in html_questions.items():
        print(f"\n--- {section.upper()} SECTION ---")
        for q in questions:
            mnemonic = q['mnemonic']
            question = q['question']
            title = q['title']
            
            # Check if mnemonic appears
            mnemonic_found = re.search(rf'\b{re.escape(mnemonic)}\b', all_pdf_text, re.IGNORECASE) is not None
            
            # Check if key concepts from question/title appear
            key_concepts = question + " " + title
            concept_found = search_concept_in_text(key_concepts, all_pdf_text)
            
            if mnemonic_found:
                found_count += 1
                print(f"  [FOUND] {mnemonic}: {question[:50]}...")
            elif concept_found:
                print(f"  [CONCEPT FOUND] {mnemonic}: {question[:50]}... (mnemonic not found)")
                missing_mnemonics.append((mnemonic, question))
            else:
                print(f"  [NOT FOUND] {mnemonic}: {question[:50]}...")
                missing_concepts.append((mnemonic, question))
    
    # Summary
    print("\n" + "=" * 70)
    print("SUMMARY")
    print("=" * 70)
    print(f"Total questions: {total_questions}")
    print(f"Mnemonics found in PDFs: {found_count}")
    print(f"Concepts found but mnemonics missing: {len(missing_mnemonics)}")
    print(f"Not found at all: {len(missing_concepts)}")
    
    if missing_mnemonics:
        print(f"\n--- QUESTIONS WITH CONCEPTS BUT MISSING MNEMONICS ({len(missing_mnemonics)}) ---")
        for mnemonic, question in missing_mnemonics[:10]:  # Show first 10
            print(f"  {mnemonic}: {question}")
    
    if missing_concepts:
        print(f"\n--- QUESTIONS NOT FOUND IN PDFS ({len(missing_concepts)}) ---")
        for mnemonic, question in missing_concepts[:10]:  # Show first 10
            print(f"  {mnemonic}: {question}")
        if len(missing_concepts) > 10:
            print(f"  ... and {len(missing_concepts) - 10} more")

if __name__ == "__main__":
    main()


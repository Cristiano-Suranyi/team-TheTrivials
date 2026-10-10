import subprocess
import sys

# Forçar a instalação dos pacotes exatamente no interpretador que está a correr este script
print("A instalar presidio-analyzer...")
subprocess.check_call([sys.executable, "-m", "pip", "install", "presidio-analyzer"])

print("A instalar presidio-anonymizer...")
subprocess.check_call([sys.executable, "-m", "pip", "install", "presidio-anonymizer"])

print("A instalar spacy...")
subprocess.check_call([sys.executable, "-m", "pip", "install", "spacy"])

print("A descarregar o modelo de Português...")
subprocess.check_call([sys.executable, "-m", "spacy", "download", "pt_core_news_lg"])

print("\nTudo instalado com sucesso! Já podes voltar a colocar o código principal.")

from presidio_analyzer import AnalyzerEngine, PatternRecognizer, Pattern
from presidio_analyzer.nlp_engine import NlpEngineProvider
from presidio_anonymizer import AnonymizerEngine, OperatorConfig

# =====================================================================
# 1. Configurar o Motor NLP do Presidio para usar o modelo de Português
# =====================================================================
configuracao_nlp = {
    "nlp_engine_name": "spacy",
    "models": [
        {"lang_code": "pt", "model_name": "pt_core_news_lg"}
    ]
}

# Criar o motor NLP usando o Provider correto da biblioteca
provider = NlpEngineProvider(nlp_configuration=configuracao_nlp)
motor_nlp = provider.create_engine()

# Inicializar o analisador injetando o motor criado através de 'nlp_engine'
analyzer = AnalyzerEngine(nlp_engine=motor_nlp)
anonymizer = AnonymizerEngine()

# =====================================================================
# 2. Criar uma Regra Customizada para Dados Portugueses (Ex: NIF)
# =====================================================================
# Expressão regular exata para validar um NIF português (9 dígitos)
regex_nif = r"\b\d{9}\b"
padrao_nif = Pattern(name="nif_pattern", regex=regex_nif, score=0.85)

reconhecedor_nif = PatternRecognizer(
    supported_entity="PT_NIF",
    supported_language="pt",
    patterns=[padrao_nif],
    context=["nif", "contribuinte", "fiscal"]
)

# Adicionar o reconhecedor de NIF ao motor do Presidio
analyzer.registry.add_recognizer(reconhecedor_nif)

# =====================================================================
# 3. Executar a Deteção e a Mascaragem (Anonimização)
# =====================================================================
texto_exemplo = (
    "Olá, o meu nome é Inês Gonçalves e moro em Lisboa. "
    "O meu NIF é 249382019 e o meu email é ines.trivial@gmail.com."
)

# Analisar o texto definindo a língua como 'pt'
resultados_analise = analyzer.analyze(
    text=texto_exemplo, 
    language="pt",
    entities=["PERSON", "LOCATION", "EMAIL_ADDRESS", "PT_NIF"]
)

# CORREÇÃO AQUI: Ajustados os parâmetros obrigatórios do operador 'mask'
config_mascaragem = OperatorConfig(
    "mask", 
    {
        "masking_char": "*", 
        "chars_to_mask": 20,       # Quantos caracteres máximos mascarar por entidade
        "from_end": False          # Começa a mascarar a partir do início do texto sensível
    }
)

# Aplicar a máscara a todas as entidades detetadas
texto_mascarado = anonymizer.anonymize(
    text=texto_exemplo,
    analyzer_results=resultados_analise,
    operators={"DEFAULT": config_mascaragem}
)

# Mostrar o resultado final no terminal
print("--- Texto Original ---")
print(texto_exemplo)
print("\n--- Texto Ofuscado ---")
print(texto_mascarado.text)

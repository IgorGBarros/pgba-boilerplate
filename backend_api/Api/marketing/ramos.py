# backend_api/Api/marketing/ramos.py
"""Pontos de partida por ramo — a pessoa ajusta no Perfil da marca. Os avisos são
as regras de publicidade do próprio ramo (conselhos de classe), que o time respeita."""

RAMOS = [
    {
        "chave": "tecnologia",
        "nome": "Tecnologia / Software / SaaS",
        "pilares": [
            "Bastidores do produto",
            "Dicas e tutoriais",
            "Casos de uso",
            "Novidades e lançamentos",
            "Cultura do time",
        ],
        "tom": "Claro, prático e confiante; sem jargão desnecessário",
        "aviso": "",
    },
    {
        "chave": "portfolio",
        "nome": "Portfólio / Projetos pessoais / Freelancer",
        "pilares": [
            "Projeto da semana",
            "Processo e aprendizados",
            "Antes e depois",
            "Ferramentas que uso",
            "Chamada para contato",
        ],
        "tom": "Autêntico, em primeira pessoa, mostrando o processo",
        "aviso": "",
    },
    {
        "chave": "varejo",
        "nome": "Varejo / E-commerce",
        "pilares": [
            "Produto em uso",
            "Ofertas e lançamentos",
            "Prova social",
            "Dicas de uso",
            "Bastidores",
        ],
        "tom": "Próximo, animado e direto ao benefício",
        "aviso": "Preço e condição de oferta sempre com validade (Código de Defesa do Consumidor).",
    },
    {
        "chave": "alimentacao",
        "nome": "Alimentação (restaurante, padaria, delivery)",
        "pilares": [
            "Prato/produto do dia",
            "Bastidores da cozinha",
            "Promoções",
            "Histórias da casa",
            "Clientes",
        ],
        "tom": "Caloroso, apetitoso e local",
        "aviso": "",
    },
    {
        "chave": "saude",
        "nome": "Saúde (clínica, consultório, odontologia)",
        "pilares": [
            "Educação em saúde",
            "Mitos e verdades",
            "Conheça a equipe",
            "Estrutura e tecnologia",
            "Como agendar",
        ],
        "tom": "Acolhedor, responsável e baseado em evidência",
        "aviso": (
            "Sem promessa de resultado ou cura, sem antes/depois sensacionalista e sem preço "
            "como chamariz (CFM 2.336/2023, CFO e demais conselhos)."
        ),
    },
    {
        "chave": "juridico",
        "nome": "Advocacia / Jurídico",
        "pilares": [
            "Direitos explicados",
            "Mudanças na lei",
            "Perguntas frequentes",
            "Bastidores do escritório",
            "Artigos",
        ],
        "tom": "Informativo, sóbrio e acessível",
        "aviso": (
            "Publicidade informativa, sem captação de clientela nem promessa de resultado "
            "(Provimento OAB 205/2021)."
        ),
    },
    {
        "chave": "contabil",
        "nome": "Contabilidade / Finanças",
        "pilares": [
            "Prazos e obrigações",
            "Dicas de gestão",
            "Mudanças tributárias",
            "Perguntas frequentes",
            "Cases",
        ],
        "tom": "Didático, confiável e objetivo",
        "aviso": (
            "Sem garantia de rentabilidade ou recomendação de investimento sem habilitação (CVM)."
        ),
    },
    {
        "chave": "imobiliario",
        "nome": "Imobiliária / Construção",
        "pilares": [
            "Imóvel em destaque",
            "Tour e bairro",
            "Dicas de compra e aluguel",
            "Obra por dentro",
            "Depoimentos",
        ],
        "tom": "Aspiracional, mas concreto (metragem, localização, condições)",
        "aviso": "Anúncio de imóvel com CRECI do corretor/imobiliária.",
    },
    {
        "chave": "educacao",
        "nome": "Educação / Cursos / Mentoria",
        "pilares": [
            "Aula rápida",
            "Resultados dos alunos",
            "Perguntas frequentes",
            "Bastidores",
            "Inscrições",
        ],
        "tom": "Inspirador e didático",
        "aviso": "",
    },
    {
        "chave": "beleza",
        "nome": "Beleza / Estética / Bem-estar",
        "pilares": [
            "Transformações",
            "Dicas de cuidado",
            "Serviços",
            "Equipe",
            "Agenda e promoções",
        ],
        "tom": "Leve, próximo e visual",
        "aviso": "Procedimento estético: sem promessa de resultado garantido.",
    },
    {
        "chave": "fitness",
        "nome": "Academia / Esporte",
        "pilares": [
            "Treino do dia",
            "Alunos e evolução",
            "Nutrição básica",
            "Aulas e horários",
            "Motivação",
        ],
        "tom": "Energético e encorajador",
        "aviso": "",
    },
    {
        "chave": "industria",
        "nome": "Indústria / B2B",
        "pilares": [
            "Soluções e aplicações",
            "Qualidade e processo",
            "Cases de clientes",
            "Feiras e eventos",
            "Sustentabilidade",
        ],
        "tom": "Técnico, sólido e orientado a resultado",
        "aviso": "",
    },
    {
        "chave": "servicos",
        "nome": "Serviços locais (reformas, oficina, pet, limpeza)",
        "pilares": ["Trabalho feito", "Dicas", "Antes e depois", "Depoimentos", "Como contratar"],
        "tom": "Simples, confiável e do bairro",
        "aviso": "",
    },
    {
        "chave": "agro",
        "nome": "Agronegócio",
        "pilares": [
            "Campo e safra",
            "Tecnologia no campo",
            "Mercado",
            "Boas práticas",
            "Pessoas do agro",
        ],
        "tom": "Direto, prático e respeitoso com o produtor",
        "aviso": "",
    },
    {
        "chave": "turismo",
        "nome": "Turismo / Hotelaria / Eventos",
        "pilares": ["Destino e experiência", "Estrutura", "Hóspedes", "Pacotes", "Dicas de viagem"],
        "tom": "Convidativo e visual",
        "aviso": "",
    },
]

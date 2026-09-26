# O cadastro de fornecedores do ERP vira o cadastro único de Parceiros de
# Negócio (conceito do SAP Business One: cliente, fornecedor e lead na mesma
# tabela, diferenciados por `tipo`). RenameModel preserva os dados e as FKs
# de OrdemCompra/ItemEstoque; os campos novos entram na migração seguinte.
from django.db import migrations


class Migration(migrations.Migration):
    dependencies = [
        ("erp", "0006_add_custo_medio_data_ultima_compra_valor_unitario"),
    ]

    operations = [
        migrations.RenameModel("Fornecedor", "ParceiroNegocio"),
        migrations.RenameModel("HistoricalFornecedor", "HistoricalParceiroNegocio"),
        # Parceiro pode ser pessoa física: o documento é CPF ou CNPJ
        migrations.RenameField("parceironegocio", "cnpj", "cpf_cnpj"),
        migrations.RenameField("historicalparceironegocio", "cnpj", "cpf_cnpj"),
    ]

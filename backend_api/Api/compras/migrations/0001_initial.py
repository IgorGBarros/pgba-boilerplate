from django.db import migrations, models
import django.db.models.deletion
import django.utils.timezone


class Migration(migrations.Migration):

    initial = True

    dependencies = [
        ("crm", "0010_leadmessage_token_cost_fields"),
    ]

    operations = [
        migrations.CreateModel(
            name="Fornecedor",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("tenant_id", models.UUIDField(db_index=True)),
                ("created_at", models.DateTimeField(default=django.utils.timezone.now)),
                ("updated_at", models.DateTimeField(auto_now=True)),
                ("created_by", models.CharField(blank=True, max_length=200)),
                ("updated_by", models.CharField(blank=True, max_length=200)),
                ("deleted_at", models.DateTimeField(blank=True, null=True)),
                ("is_active", models.BooleanField(default=True, db_index=True)),
                ("nome", models.CharField(max_length=255)),
                ("categoria", models.CharField(blank=True, max_length=100)),
                ("telefone", models.CharField(blank=True, max_length=30)),
                ("email", models.EmailField(blank=True, max_length=254)),
                ("endereco", models.TextField(blank=True)),
                ("cidade", models.CharField(blank=True, max_length=100)),
                ("estado", models.CharField(blank=True, max_length=2)),
                ("latitude", models.DecimalField(blank=True, decimal_places=7, max_digits=10, null=True)),
                ("longitude", models.DecimalField(blank=True, decimal_places=7, max_digits=10, null=True)),
                ("source", models.CharField(
                    choices=[("manual", "Cadastro Manual"), ("openstreetmap", "OpenStreetMap"), ("indicado", "Indicado")],
                    default="manual", max_length=20,
                )),
                ("osm_id", models.CharField(blank=True, max_length=50)),
                ("website", models.URLField(blank=True)),
                ("observacoes", models.TextField(blank=True)),
            ],
            options={"ordering": ["nome"], "verbose_name": "Fornecedor", "verbose_name_plural": "Fornecedores"},
        ),
        migrations.CreateModel(
            name="ItemNecessario",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("tenant_id", models.UUIDField(db_index=True)),
                ("created_at", models.DateTimeField(default=django.utils.timezone.now)),
                ("updated_at", models.DateTimeField(auto_now=True)),
                ("created_by", models.CharField(blank=True, max_length=200)),
                ("updated_by", models.CharField(blank=True, max_length=200)),
                ("deal", models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name="itens_necessarios", to="crm.deal")),
                ("nome", models.CharField(max_length=255)),
                ("descricao", models.TextField(blank=True)),
                ("quantidade", models.DecimalField(decimal_places=3, default=1, max_digits=10)),
                ("unidade", models.CharField(default="un", max_length=20)),
                ("tem_estoque", models.BooleanField(default=False)),
                ("quantidade_estoque", models.DecimalField(decimal_places=3, default=0, max_digits=10)),
                ("categoria", models.CharField(blank=True, max_length=100)),
            ],
            options={"ordering": ["nome"], "verbose_name": "Item Necessário", "verbose_name_plural": "Itens Necessários"},
        ),
        migrations.CreateModel(
            name="Orcamento",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("tenant_id", models.UUIDField(db_index=True)),
                ("created_at", models.DateTimeField(default=django.utils.timezone.now)),
                ("updated_at", models.DateTimeField(auto_now=True)),
                ("created_by", models.CharField(blank=True, max_length=200)),
                ("updated_by", models.CharField(blank=True, max_length=200)),
                ("deal", models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name="orcamentos", to="crm.deal")),
                ("fornecedor", models.ForeignKey(on_delete=django.db.models.deletion.PROTECT, related_name="orcamentos", to="compras.fornecedor")),
                ("status", models.CharField(
                    choices=[("rascunho", "Rascunho"), ("enviado", "Enviado ao Fornecedor"), ("recebido", "Resposta Recebida"), ("aprovado", "Aprovado"), ("rejeitado", "Rejeitado")],
                    default="rascunho", max_length=20,
                )),
                ("valor_total", models.DecimalField(blank=True, decimal_places=2, max_digits=14, null=True)),
                ("prazo_entrega_dias", models.PositiveIntegerField(blank=True, null=True)),
                ("observacoes", models.TextField(blank=True)),
                ("aprovado_em", models.DateTimeField(blank=True, null=True)),
                ("aprovado_por", models.CharField(blank=True, max_length=200)),
                ("enviado_em", models.DateTimeField(blank=True, null=True)),
                ("resposta_em", models.DateTimeField(blank=True, null=True)),
            ],
            options={"ordering": ["-created_at"], "verbose_name": "Orçamento", "verbose_name_plural": "Orçamentos"},
        ),
        migrations.CreateModel(
            name="ItemOrcamento",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("tenant_id", models.UUIDField(db_index=True)),
                ("created_at", models.DateTimeField(default=django.utils.timezone.now)),
                ("updated_at", models.DateTimeField(auto_now=True)),
                ("created_by", models.CharField(blank=True, max_length=200)),
                ("updated_by", models.CharField(blank=True, max_length=200)),
                ("orcamento", models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name="itens", to="compras.orcamento")),
                ("item_necessario", models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, to="compras.itemnecessario")),
                ("nome", models.CharField(max_length=255)),
                ("quantidade", models.DecimalField(decimal_places=3, max_digits=10)),
                ("unidade", models.CharField(default="un", max_length=20)),
                ("preco_unitario", models.DecimalField(blank=True, decimal_places=4, max_digits=12, null=True)),
            ],
            options={"ordering": ["nome"], "verbose_name": "Item de Orçamento", "verbose_name_plural": "Itens de Orçamento"},
        ),
        migrations.CreateModel(
            name="PedidoCompra",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("tenant_id", models.UUIDField(db_index=True)),
                ("created_at", models.DateTimeField(default=django.utils.timezone.now)),
                ("updated_at", models.DateTimeField(auto_now=True)),
                ("created_by", models.CharField(blank=True, max_length=200)),
                ("updated_by", models.CharField(blank=True, max_length=200)),
                ("deleted_at", models.DateTimeField(blank=True, null=True)),
                ("is_active", models.BooleanField(default=True, db_index=True)),
                ("orcamento", models.OneToOneField(on_delete=django.db.models.deletion.PROTECT, related_name="pedido", to="compras.orcamento")),
                ("project", models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name="pedidos_compra", to="crm.project")),
                ("status", models.CharField(
                    choices=[("criado", "Criado"), ("enviado", "Enviado ao Fornecedor"), ("confirmado", "Confirmado"), ("em_transito", "Em Trânsito"), ("entregue", "Entregue"), ("cancelado", "Cancelado")],
                    default="criado", max_length=20,
                )),
                ("numero_pedido", models.CharField(blank=True, max_length=50)),
                ("previsao_entrega", models.DateField(blank=True, null=True)),
                ("observacoes", models.TextField(blank=True)),
                ("entregue_em", models.DateTimeField(blank=True, null=True)),
            ],
            options={"ordering": ["-created_at"], "verbose_name": "Pedido de Compra", "verbose_name_plural": "Pedidos de Compra"},
        ),
    ]

import os
import sys

if __name__ == '__main__':
    # Aponta para config.settings.dev ou .prod conforme DEBUG
    env = 'dev' if os.environ.get('DEBUG') == 'True' else 'prod'
    os.environ.setdefault('DJANGO_SETTINGS_MODULE', f'config.settings.{env}')
    try:
        from django.core.management import execute_from_command_line
    except ImportError as exc:
        raise ImportError("Couldn't import Django.") from exc
    execute_from_command_line(sys.argv)
FROM mysql:8.4
COPY docker/mysql-utf8.cnf /etc/mysql/conf.d/utf8.cnf
RUN chmod 644 /etc/mysql/conf.d/utf8.cnf

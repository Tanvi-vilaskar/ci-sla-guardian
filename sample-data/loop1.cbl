       IDENTIFICATION DIVISION.
       PROGRAM-ID. HEAVY1.

       DATA DIVISION.
       WORKING-STORAGE SECTION.
       01  WS-I             PIC 9(6)   VALUE 0.
       01  WS-J             PIC 9(6)   VALUE 0.
       01  WS-K             PIC 9(6)   VALUE 0.
       01  WS-L             PIC 9(6)   VALUE 0.
       01  WS-M             PIC 9(6)   VALUE 0.
       01  WS-N             PIC 9(6)   VALUE 0.
       01  WS-TEMP          PIC 9(18)  VALUE 0.
       01  WS-TEMP2         PIC 9(18)  VALUE 0.
       01  WS-TOTAL         PIC 9(18)  VALUE 0.
       01  WS-ARRAY.
           05 WS-VAL  OCCURS 200 TIMES PIC 9(6) VALUE 1.

       PROCEDURE DIVISION.

       MAIN-PARA.
           PERFORM INIT-ARRAY
           PERFORM NESTED-LOOPS
           STOP RUN.

       INIT-ARRAY.
           PERFORM VARYING WS-I FROM 1 BY 1
                   UNTIL WS-I > 200
               MOVE WS-I TO WS-VAL(WS-I)
           END-PERFORM.

       NESTED-LOOPS.
           PERFORM VARYING WS-I FROM 1 BY 1
                   UNTIL WS-I > 500
               PERFORM VARYING WS-J FROM 1 BY 1
                       UNTIL WS-J > 400
                   PERFORM VARYING WS-K FROM 1 BY 1
                           UNTIL WS-K > 50
                       PERFORM INNER-CALC
                   END-PERFORM
               END-PERFORM
           END-PERFORM.

        INNER-CALC.
           PERFORM VARYING WS-L FROM 1 BY 1
                   UNTIL WS-L > 200
               PERFORM VARYING WS-M FROM 1 BY 1
                       UNTIL WS-M > 200
                   PERFORM VARYING WS-N FROM 1 BY 1
                           UNTIL WS-N > 30
                       COMPUTE WS-TEMP =
                               WS-VAL
                             + (WS-I * WS-J * WS-K)
                             + (WS-L * WS-M * WS-N)
                       COMPUTE WS-TEMP2 =
                               WS-TEMP
                             + (WS-I * WS-J)
                             + (WS-K * WS-L)
                             + (WS-M * WS-N)
                       ADD WS-TEMP2 TO WS-TOTAL
                   END-PERFORM
               END-PERFORM
           END-PERFORM.